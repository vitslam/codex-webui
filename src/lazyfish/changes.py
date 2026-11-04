"""Bounded read-only worktree snapshots, ported from the reference UI backend."""
import os
import stat
import subprocess
import hashlib
import difflib
from pathlib import Path

class ChangeTracker:
    """Read-only, bounded before/after worktree review; never touches Git's index."""
    MAX_FILES = 2000
    MAX_TEXT = 256 * 1024
    MAX_SNAPSHOT = 8 * 1024 * 1024
    MAX_DIFF = 512 * 1024

    def __init__(self, cwd, discover=True,excluded=()):
        self.excluded=[Path(p).resolve() for p in excluded]
        self.children = []
        self.discovery_truncated = False
        self.cwd = cwd
        self.root = None
        self.before = None
        self.error = ''
        try:
            self.root = self.git(cwd, 'rev-parse', '--show-toplevel').decode().strip()
            self.before = self.snapshot()
        except (OSError, ValueError, subprocess.SubprocessError):
            self.error = '工作目录没有可读取的 Git 仓库，未采集文件快照。'
            if discover:
                # The default workspace often contains several project repositories.
                try:
                    candidates = [p for p in sorted(Path(cwd).iterdir())
                                  if not p.is_symlink() and (p / '.git').exists()]
                    self.children = [ChangeTracker(str(p), discover=False,excluded=self.excluded) for p in candidates[:8]]
                    self.discovery_truncated = len(candidates) > 8
                    if candidates:
                        self.error = '最多采集工作目录下一层的 8 个 Git 仓库。'
                except OSError:
                    pass

    @staticmethod
    def git(cwd, *args):
        env = os.environ.copy()
        env['GIT_OPTIONAL_LOCKS'] = '0'
        return subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', cwd, *args],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              env=env, timeout=10, check=True).stdout

    def ref(self, *args):
        try:
            return self.git(self.root, *args).decode('utf-8', errors='replace').strip()
        except subprocess.CalledProcessError:
            return ''

    def snapshot(self):
        names = sorted(set(os.fsdecode(p) for p in self.git(
            self.root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split(b'\0') if p))
        files, budget = {}, self.MAX_SNAPSHOT
        partial = len(names) > self.MAX_FILES
        for name in names[:self.MAX_FILES]:
            path = Path(self.root) / name
            try:
                if any(path.resolve().is_relative_to(root) for root in self.excluded):continue
                # Never traverse a symlinked parent into another tree.
                path.parent.resolve().relative_to(Path(self.root).resolve())
                info = path.lstat()
                mode = stat.S_IFMT(info.st_mode) | (info.st_mode & 0o111)
                if stat.S_ISLNK(info.st_mode):
                    raw = os.fsencode(os.readlink(path))
                elif stat.S_ISREG(info.st_mode):
                    with path.open('rb') as stream:
                        raw = stream.read(self.MAX_TEXT + 1)
                else:
                    files[name] = {'fingerprint': (mode, info.st_mtime_ns), 'text': None, 'mode': mode}
                    continue
                oversized = len(raw) > self.MAX_TEXT
                digest = hashlib.sha256(raw).hexdigest()
                fingerprint = (mode, digest, info.st_size, info.st_mtime_ns if oversized else 0)
                text = None
                if not oversized and b'\0' not in raw and len(raw) <= budget:
                    try:
                        text = raw.decode('utf-8')
                        budget -= len(raw)
                    except UnicodeError:
                        pass
                files[name] = {'fingerprint': fingerprint, 'text': text, 'mode': mode}
            except FileNotFoundError:
                files[name] = None
            except (OSError, ValueError):
                partial = True  # An unreadable file must never look like a deletion.
        return {'files': files, 'names': set(names), 'head': self.ref('rev-parse', '--verify', 'HEAD'),
                'partial': partial}

    def report(self):
        report = {'version': 1, 'state': 'unavailable', 'reason': self.error, 'repo': self.root,
                  'files': [], 'file_count': 0, 'additions': 0, 'deletions': 0,
                  'git': None}
        if self.children:
            reports = [child.report() for child in self.children]
            changed = [r for r in reports if r['file_count'] or r['git'] and
                       (r['git']['before'] != r['git']['after'])]
            selected = changed or reports
            if len(selected) == 1:
                result = dict(selected[0])
                if self.discovery_truncated:
                    result.update(state='partial', reason=self.error + result['reason'])
                return result
            report.update(state='partial', repo=self.cwd, reason=self.error,
                          repositories=[{'repo': r['repo'], 'git': r['git']} for r in selected])
            budget = self.MAX_DIFF
            for result in selected:
                for entry in result['files']:
                    if len(report['files']) >= 100:
                        break
                    prefix = os.path.relpath(result['repo'], self.cwd)
                    entry = dict(entry, path=prefix + '/' + entry['path'])
                    raw = entry['diff'].encode('utf-8')
                    if len(raw) > budget:
                        entry['diff'] = raw[:budget].decode('utf-8', errors='ignore')
                        entry['notice'] = 'Diff 已截断。'
                    budget -= min(len(raw), budget)
                    report['files'].append(entry)
                for key in ('file_count', 'additions', 'deletions'):
                    report[key] += result[key]
            return report
        if self.before is None:
            return report
        try:
            after = self.snapshot()
            report['state'] = 'partial' if self.before['partial'] or after['partial'] else 'ready'
            budget = self.MAX_DIFF
            for name in sorted(set(self.before['files']) | set(after['files'])):
                # Skip unsampled/unreadable paths instead of inventing added/deleted files.
                if any(name in snap['names'] and name not in snap['files'] for snap in (self.before, after)):
                    continue
                old, new = self.before['files'].get(name), after['files'].get(name)
                if (old or {}).get('fingerprint') == (new or {}).get('fingerprint'):
                    continue
                report['file_count'] += 1
                if len(report['files']) >= 100:
                    report['state'] = 'partial'
                    continue
                entry = {'path': name, 'status': 'added' if old is None else 'deleted' if new is None else 'modified',
                         'additions': 0, 'deletions': 0, 'diff': '', 'notice': ''}
                if any(value is not None and value['text'] is None for value in (old, new)):
                    entry['notice'] = '二进制、大文件或未缓存的内容，仅记录文件变化。'
                else:
                    before_lines = old['text'].splitlines(keepends=True) if old else []
                    after_lines = new['text'].splitlines(keepends=True) if new else []
                    # Avoid quadratic matching for repetitive files.
                    matcher = difflib.SequenceMatcher(None, before_lines, after_lines, autojunk=True)
                    chunks = []
                    for group in matcher.get_grouped_opcodes(3):
                        first, last = group[0], group[-1]
                        old_count, new_count = last[2] - first[1], last[4] - first[3]
                        chunks.append('@@ -{},{} +{},{} @@\n'.format(first[1] + bool(old_count), old_count, first[3] + bool(new_count), new_count))
                        def diff_lines(prefix, lines):
                            for line in lines:
                                yield prefix + line.rstrip('\n') + '\n'
                                if not line.endswith('\n'):
                                    yield '\\ No newline at end of file\n'
                        for tag, a, b, c, d in group:
                            if tag == 'equal':
                                chunks.extend(diff_lines(' ', before_lines[a:b]))
                            if tag in ('delete', 'replace'):
                                chunks.extend(diff_lines('-', before_lines[a:b]))
                                entry['deletions'] += b - a
                            if tag in ('insert', 'replace'):
                                chunks.extend(diff_lines('+', after_lines[c:d]))
                                entry['additions'] += d - c
                    header = '--- {}\n+++ {}\n'.format('a/' + name if old else '/dev/null', 'b/' + name if new else '/dev/null')
                    raw = (header + ''.join(chunks)).encode('utf-8')
                    allowance = min(budget, 96 * 1024)
                    entry['diff'] = raw[:allowance].decode('utf-8', errors='ignore')
                    budget -= min(len(raw), allowance)
                    if len(raw) > allowance:
                        entry['notice'] = 'Diff 已截断。'
                    elif not chunks:
                        entry['notice'] = '文件模式或换行发生变化。'
                report['files'].append(entry)
                report['additions'] += entry['additions']; report['deletions'] += entry['deletions']
            head, previous = after['head'], self.before['head']
            commits, history_changed = [], False
            if head and head != previous:
                history_changed = bool(previous and subprocess.run(
                    ['git', '-C', self.root, 'merge-base', '--is-ancestor', previous, head],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10).returncode)
                if not history_changed:
                    args = ['log', '-30', '--format=%H%x00%s', head] + (['^' + previous] if previous else [])
                    for line in self.ref(*args).splitlines():
                        oid, subject = line.split('\0', 1)
                        commits.append({'id': oid, 'subject': subject[:300]})
            upstream = self.ref('rev-parse', '--abbrev-ref', '@{upstream}')
            counts = self.ref('rev-list', '--left-right', '--count', 'HEAD...@{upstream}').split() if upstream else []
            report['git'] = {'before': previous, 'after': head, 'branch': self.ref('symbolic-ref', '--short', '-q', 'HEAD'),
                             'commits': commits, 'history_changed': history_changed, 'upstream': upstream,
                             'ahead': int(counts[0]) if len(counts) == 2 else None,
                             'behind': int(counts[1]) if len(counts) == 2 else None,
                             'dirty': bool(self.ref('status', '--porcelain'))}
            report['reason'] = '只展示已采集的文件；仓库过大或部分文件不可读取。' if report['state'] == 'partial' else ''
        except (OSError, ValueError, subprocess.SubprocessError):
            report['state'] = 'unavailable'
            report['reason'] = '文件变更采集失败，任务回复仍可正常查看。'
        return report
