#!/usr/bin/env bash
# Turns on Language Mod in every new Claude Code cloud session.
# Paste this file into your cloud environment's Setup script.
set -u

MOD_DIR="${MOD_DIR:-/opt/languagemod}"
# Change to main once the mod is merged there.
BRANCH="${BRANCH:-claude/elegant-fermat-qwakv4}"

rm -rf "$MOD_DIR"
# A failed download leaves the session as it would be without the mod.
git clone --quiet --depth 1 --branch "$BRANCH" https://github.com/Orzzoniz/languageMod "$MOD_DIR" || exit 0

# Claude Code loads each folder named in CLAUDE_CODE_PLUGIN_DIRS as a plugin.
mkdir -p "$HOME/.claude"
python3 - "$MOD_DIR" <<'PY'
import json, os, sys
path = os.path.expanduser('~/.claude/settings.json')
settings = json.load(open(path)) if os.path.exists(path) else {}
env = settings.setdefault('env', {})
folders = [f for f in env.get('CLAUDE_CODE_PLUGIN_DIRS', '').split(':') if f and f != sys.argv[1]]
env['CLAUDE_CODE_PLUGIN_DIRS'] = ':'.join(folders + [sys.argv[1]])
json.dump(settings, open(path, 'w'), indent=2)
PY
