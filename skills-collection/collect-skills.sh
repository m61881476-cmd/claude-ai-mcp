#!/usr/bin/env bash
# Collect every Claude skill available in this environment into one folder + one zip.
# Usage: ./collect-skills.sh [output-dir]
set -euo pipefail
OUT="${1:-$(cd "$(dirname "$0")" && pwd)/all-skills}"
rm -rf "$OUT"; mkdir -p "$OUT"
INDEX="$OUT/INDEX.md"
printf '# All collected skills\n\n| # | Group | Skill | Description |\n|---|---|---|---|\n' > "$INDEX"
n=0

desc() { # first "description:" line from SKILL.md frontmatter
  awk '/^---/{c++; next} c==1 && /^description:/{sub(/^description:[ ]*/,""); gsub(/\|/,"/"); print substr($0,1,160); exit}' "$1"
}

add() { # $1=group  $2=skill dir
  local group="$1" dir="$2" name dest
  name="$(basename "$dir")"
  dest="$OUT/$group/$name"
  [ -e "$dest" ] && return 0
  mkdir -p "$OUT/$group"
  cp -rL "$dir" "$dest" 2>/dev/null || cp -r "$dir" "$dest"
  rm -rf "$dest/.git" "$dest/node_modules"
  n=$((n+1))
  printf '| %d | %s | %s | %s |\n' "$n" "$group" "$name" "$(desc "$dir/SKILL.md")" >> "$INDEX"
}

# 1) Anthropic built-in skills
for root in /mnt/skills/public /mnt/skills/examples; do
  [ -d "$root" ] || continue
  for s in "$root"/*/; do [ -f "$s/SKILL.md" ] && add "anthropic-$(basename "$root")" "${s%/}"; done
done

# 2) Personal skills
for root in /root/.claude/skills /home/claude/.claude/skills "$HOME/.claude/skills"; do
  [ -d "$root" ] || continue
  while IFS= read -r f; do add "personal" "$(dirname "$f")"; done < <(find "$root" -name SKILL.md -not -path '*/node_modules/*' 2>/dev/null)
done

# 3) Plugin skills (named by plugin)
for p in /root/.claude/plugins/synced/*/*/; do
  [ -d "$p" ] || continue
  pname="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["name"])' "$p/.claude-plugin/plugin.json" 2>/dev/null || basename "$p")"
  while IFS= read -r f; do add "plugin-$pname" "$(dirname "$f")"; done < <(find "$p" -name SKILL.md -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null)
  # slash-command style skills (commands/*.md)
  if [ -d "$p/commands" ] && ls "$p"/commands/*.md >/dev/null 2>&1; then
    mkdir -p "$OUT/plugin-$pname/commands"
    for c in "$p"/commands/*.md; do
      cp "$c" "$OUT/plugin-$pname/commands/"; n=$((n+1))
      printf '| %d | %s | /%s:%s | %s |\n' "$n" "plugin-$pname" "$pname" "$(basename "$c" .md)" "$(desc "$c")" >> "$INDEX"
    done
  fi
done

printf '\nTotal: %d skills\n' "$n" >> "$INDEX"
( cd "$(dirname "$OUT")" && rm -f all-skills.zip && zip -qr all-skills.zip "$(basename "$OUT")" )
echo "Collected $n skills -> $OUT  (zip: $(dirname "$OUT")/all-skills.zip)"
