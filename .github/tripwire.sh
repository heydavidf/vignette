#!/usr/bin/env bash
# tripwire.sh: cheap checks for mistakes coding agents make that linters and secret scanners miss.
# Usage: tripwire.sh [BASE_REF]
#   Always checks tracked files for junk and personal paths.
#   With BASE_REF (e.g. origin/main or a commit), also checks lines added since BASE_REF for silenced checks.
# Exit 1 on any failure. Put "tripwire-allow" on a line to accept it deliberately.
# Extra private words to block (names, client names): TRIPWIRE_WORDS="word1|word2"
set -uo pipefail

fail=0
report() { printf '%s\n' "$1"; fail=1; }

# 1. Files that should never be tracked.
junk='(^|/)(\.env|\.env\.local|\.DS_Store|.*\.pyc|settings\.local\.json)$|(^|/)(__pycache__|node_modules|\.grok|\.venv|venv)/'
tracked_junk=$(git ls-files | grep -E "$junk" | grep -v -E '(^|/)\.env\.example$' || true)
[ -n "$tracked_junk" ] && report "Tracked files that should be ignored:
$tracked_junk"

# 2. Personal paths and private words in tracked text files.
pattern='/Users/[A-Za-z0-9._-]+|/home/[A-Za-z0-9._-]+|C:\\Users\\|~/[A-Za-z.]'
[ -n "${TRIPWIRE_WORDS:-}" ] && pattern="$pattern|${TRIPWIRE_WORDS}"
personal=$(git grep -I -n -E "$pattern" -- . ':!*.lock' ':!package-lock.json' 2>/dev/null | grep -v 'tripwire-allow' | grep -v -E '^\.github/tripwire\.sh:' || true)
[ -n "$personal" ] && report "Personal paths or private words in tracked files:
$personal"

# 3. Checks silenced in lines added since BASE_REF.
if [ $# -ge 1 ]; then
  base="$1"
  if ! git cat-file -e "$base" 2>/dev/null; then report "Base ref $base not found; pass a ref that exists (for example origin/main after fetching)"; fi
  silenced='# *noqa|# *type: *ignore|eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck|biome-ignore|\bas any\b|pytest\.mark\.skip|pytest\.skip\(|unittest\.skip|\b(it|test|describe)\.skip\(|\bx(it|describe)\(|--no-verify'
  added=$(git diff -U0 "$base"...HEAD -- . ':!.github/tripwire.sh' | grep -E '^\+[^+]' | grep -E "$silenced" | grep -v 'tripwire-allow' || true)
  [ -n "$added" ] && report "New lines that silence a check (justify with tripwire-allow or remove):
$added"
fi

[ "$fail" -eq 0 ] && echo "tripwire: clean"
exit "$fail"
