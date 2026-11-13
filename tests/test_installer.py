"""Exercise the installer in an isolated home with a fake Python/CLI, offline."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='installer-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'home with spaces'
        self.home.mkdir()
        self.project = self.root / "project 'quoted'"
        (self.project / 'scripts').mkdir(parents=True)
        (self.project / 'bin').mkdir()
        source = Path(__file__).resolve().parents[1]
        for name in ('scripts/install.sh', 'bin/lazyfish'):
            shutil.copy2(source / name, self.project / name)
        self.venv = self.root / "custom env 'quoted'"
        (self.venv / 'bin').mkdir(parents=True)
        (self.venv / 'pyvenv.cfg').touch()
        self.python = self.venv / 'bin/python'
        self.python.write_text('#!/bin/sh\nexit 0\n')
        self.python.chmod(0o700)
        cli = self.venv / 'bin/lazyfish'
        cli.write_text('#!/bin/sh\nprintf "<%s>\\n" "$@"\n')
        cli.chmod(0o700)
        # macOS /bin/chmod rejects "--"; keep a stub first on PATH so Linux
        # CI catches a regression of that installer bug.
        chmod_dir = self.root / 'cmds'
        chmod_dir.mkdir()
        chmod = chmod_dir / 'chmod'
        chmod.write_text(
            '#!/bin/sh\n'
            'for arg in "$@"; do\n'
            '  if [ "$arg" = "--" ]; then\n'
            '    echo "chmod: --: No such file or directory" >&2\n'
            '    exit 1\n'
            '  fi\n'
            'done\n'
            'exec /bin/chmod "$@"\n'
        )
        chmod.chmod(0o700)
        self.env = dict(os.environ, HOME=str(self.home), SHELL='/bin/bash',
                        PYTHON=str(self.python), VENV_DIR=str(self.venv),
                        PATH=str(chmod_dir) + ':/usr/bin:/bin',
                        XDG_CACHE_HOME=str(self.root/'cache'))
        self.env.pop('ZDOTDIR', None)

    def install(self, success=True):
        result = subprocess.run(['bash', str(self.project/'scripts/install.sh')],
                                env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode == 0, success, result.stdout+result.stderr)
        return result

    def test_missing_directory_path_and_reinstall(self):
        rc = self.home / '.bashrc'
        rc.write_text('# Existing settings\n')
        first = self.install()
        self.assertIn('source ', first.stdout)
        self.assertIn('.bashrc', first.stdout)
        self.install()
        text = rc.read_text()
        self.assertTrue(text.startswith('# Existing settings\n'))
        self.assertEqual(text.count('# Lazyfish: user commands'), 1)
        # A fresh shell can source the file twice without duplicating PATH;
        # the generated command works outside the checkout with quoted arguments.
        run_env = dict(self.env)
        run_env.pop('VENV_DIR')
        result = subprocess.run(['bash', '-c',
            'source "$HOME/.bashrc"; source "$HOME/.bashrc"; '
            'printf "%s\\n" "$PATH"; lazyfish token "argument with spaces"'],
            env=run_env, cwd=self.home, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines()[0].split(':').count(str(self.home/'.local/bin')), 1)
        self.assertIn('<token>\n<argument with spaces>', result.stdout)

    def test_existing_path_needs_no_shell_change(self):
        self.env['PATH'] = str(self.home/'.local/bin')+':'+self.env['PATH']
        result = self.install()
        self.assertNotIn('source ', result.stdout)
        self.assertFalse((self.home/'.bashrc').exists())
        self.assertTrue((self.home/'.local/bin/lazyfish').is_file())

    def test_zsh_and_custom_startup_directory(self):
        self.env.update(SHELL='/usr/bin/zsh', ZDOTDIR=str(self.home/'zsh config'))
        result = self.install()
        self.assertIn('.zshrc', result.stdout)
        self.assertTrue((Path(self.env['ZDOTDIR'])/'.zshrc').is_file())
        self.assertFalse((self.home/'.bashrc').exists())

    def test_other_shell_uses_profile(self):
        self.env['SHELL'] = '/bin/sh'
        result = self.install()
        self.assertIn('.profile', result.stdout)
        self.assertTrue((self.home/'.profile').is_file())

    def test_unrelated_command_and_symlink_are_preserved(self):
        command = self.home/'.local/bin/lazyfish'
        command.parent.mkdir(parents=True)
        command.write_text('another tool\n')
        self.install(success=False)
        self.assertEqual(command.read_text(), 'another tool\n')
        command.unlink()
        target = self.root/'existing'
        target.write_text('untouched\n')
        command.symlink_to(target)
        self.install(success=False)
        self.assertTrue(command.is_symlink())
        self.assertEqual(target.read_text(), 'untouched\n')
