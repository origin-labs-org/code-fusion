#!/usr/bin/env bash
# Merge the claude-code-templates skill catalog into payloads/skills/ (flat).
# Rules (per Prime Orchestrator TASK 3 brief, 2026-11-01):
#   - pre-existing payloads/skills entry wins; incoming cct entry is skipped
#   - internal cct duplicates: first (by category order) wins, rest skipped
#   - every skip is recorded in payloads/CONFLICT.md
set -u
comp="/c/Users/thaku/Workspaces/fusion/.extract-tmp/cct/cli-tool/components/skills"
dst="/c/Users/thaku/Workspaces/fusion/code-fusion/payloads/skills"
conflict_log="/c/Users/thaku/Workspaces/fusion/code-fusion/payloads/CONFLICT.md"

: > "$conflict_log"
{
  echo "# CONFLICT.md — skill/component name conflicts"
  echo ""
  echo "Recorded while merging the claude-code-templates catalog"
  echo "(github.com/davila7/claude-code-templates, MIT) on 2026-11-01."
  echo ""
  echo "Rules applied:"
  echo "- A pre-existing payloads/skills entry wins; the incoming cct entry is"
  echo "  skipped (not overwritten, not renamed)."
  echo "- The cct catalog has the same skill name under two categories in a few"
  echo "  cases; the first in category order wins and the rest are skipped."
  echo ""
  echo "## Existing payloads/skills vs incoming cct catalog"
  echo ""
  echo "| Existing skill (kept) | Incoming cct entry (skipped) |"
  echo "| --- | --- |"
} >> "$conflict_log"

copied=0
skipped_existing=0
skipped_dupe=0
dupe_lines=""

: > /tmp/cct_seen.txt
for catdir in $(ls "$comp"); do
  [ -d "$comp/$catdir" ] || continue
  for sk in $(ls "$comp/$catdir"); do
    [ -f "$comp/$catdir/$sk/SKILL.md" ] || continue
    if grep -qx "$sk" /tmp/cct_seen.txt; then
      skipped_dupe=$((skipped_dupe+1))
      dupe_lines="$dupe_lines
| \`$sk\` | \`$catdir/$sk\` (later category, skipped) |"
      continue
    fi
    echo "$sk" >> /tmp/cct_seen.txt
    if [ -d "$dst/$sk" ]; then
      echo "| \`$sk\` | \`$catdir/$sk\` (cct) |" >> "$conflict_log"
      skipped_existing=$((skipped_existing+1))
      continue
    fi
    cp -r "$comp/$catdir/$sk" "$dst/$sk"
    copied=$((copied+1))
  done
done

{
  echo ""
  echo "## Internal duplicates within the cct catalog"
  echo ""
  echo "Same skill name appears under two categories in the source catalog."
  echo "First (alphabetical by category) wins; the rest are listed here."
  echo ""
  echo "| Kept (first category) | Skipped (later category) |"
  echo "| --- | --- |"
  echo "$dupe_lines"
  echo ""
  echo "## Summary"
  echo ""
  echo "- copied: $copied"
  echo "- skipped (existing wins): $skipped_existing"
  echo "- skipped (internal dupe): $skipped_dupe"
} >> "$conflict_log"

echo "copied=$copied skipped_existing=$skipped_existing skipped_dupe=$skipped_dupe"
