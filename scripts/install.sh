#!/usr/bin/env bash
# Local, non-root installation. Review this script before running it.
set -euo pipefail
umask 077

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command_dir="$HOME/.local/bin"
command_path="$command_dir/lazyfish"
command_marker='# Lazyfish managed command entry'
if [[ -L "$command_path" ]] || { [[ -e "$command_path" ]] && { [[ ! -f "$command_path" ]] || ! grep -Fxq -- "$command_marker" "$command_path"; }; }; then
  printf '%s\n' "Command already exists; refusing to overwrite: $command_path" >&2
  exit 1
fi
python_bin="${PYTHON:-}"
if [[ -z "$python_bin" ]]; then
  for candidate in python3.14 python3.13 python3.12 python3.11 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3,11))' 2>/dev/null; then
      python_bin="$candidate"
      break
    fi
  done
fi
if [[ -z "$python_bin" ]] || ! "$python_bin" -c 'import sys; sys.exit(sys.version_info < (3,11))'; then
  printf '%s\n' 'Python 3.11+ is required. Set PYTHON=/path/to/python3.11 (or newer).' >&2
  exit 1
fi
venv_dir="${VENV_DIR:-$project_dir/.venv}"
if [[ -e "$venv_dir" && ! -f "$venv_dir/pyvenv.cfg" ]]; then
  printf '%s\n' 'VENV_DIR exists and is not a virtual environment; refusing to overwrite it.' >&2
  exit 1
fi
if [[ ! -f "$venv_dir/pyvenv.cfg" ]]; then
  "$python_bin" -m venv "$venv_dir"
fi
# Keep pip/build temporary files private and outside the system /tmp.
cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/lazyfish"
mkdir -p -- "$cache_root"
if [[ -L "$cache_root" || ! -O "$cache_root" ]]; then
  printf '%s\n' 'Installer cache must be owned by the current user and not be a symlink.' >&2
  exit 1
fi
# macOS chmod treats "--" as a file name, so do not pass it.
chmod 700 "$cache_root"
install_tmp="$(mktemp -d "$cache_root/install.XXXXXXXX")"
trap 'rm -rf -- "$install_tmp"' EXIT
export TMPDIR="$install_tmp" TEMP="$install_tmp" TMP="$install_tmp"
venv_dir="$(cd -- "$venv_dir" && pwd)"
export VENV_DIR="$venv_dir"
"$venv_dir/bin/python" -m pip install --disable-pip-version-check "$project_dir"
"$project_dir/bin/lazyfish" init "$@"
printf '%s\n' 'Codex CLI must be installed separately: https://learn.chatgpt.com/docs/codex/cli' 'If codex is not on PATH, set LAZYFISH_CODEX_BIN to its executable path.'

# Keep the public command on the user's PATH without requiring root.
mkdir -p -- "$command_dir"
{
  printf '%s\n' '#!/usr/bin/env bash' "$command_marker" 'set -eu'
  printf 'exec %q "$@"\n' "$venv_dir/bin/lazyfish"
} > "$install_tmp/lazyfish"
chmod 700 "$install_tmp/lazyfish"
# Move atomically so reinstalling never exposes a partially written launcher.
command_tmp="$(mktemp "$command_dir/.lazyfish.XXXXXXXX")"
cp -- "$install_tmp/lazyfish" "$command_tmp"
chmod 700 "$command_tmp"
mv -f -- "$command_tmp" "$command_path"

case ":$PATH:" in
  *":$command_dir:"*) ;;
  *)
    case "${SHELL:-}" in
      */bash|bash) shell_rc="$HOME/.bashrc"; source_command=source ;;
      */zsh|zsh) shell_rc="${ZDOTDIR:-$HOME}/.zshrc"; source_command=source ;;
      *) shell_rc="$HOME/.profile"; source_command=. ;;
    esac
    mkdir -p -- "$(dirname -- "$shell_rc")"
    path_marker='# Lazyfish: user commands'
    if ! grep -Fxq -- "$path_marker" "$shell_rc" 2>/dev/null; then
      cat >> "$shell_rc" <<'LAZYFISH_PATH'

# Lazyfish: user commands
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) export PATH="$HOME/.local/bin:$PATH" ;;
esac
LAZYFISH_PATH
    fi
    printf '\nRun once in this terminal:\n  %s %q\n' "$source_command" "$shell_rc"
    ;;
esac
printf '\nStart: lazyfish serve\nToken: lazyfish token\n'
