#!/usr/bin/env bash
# PostToolUse hook — one line per tool call, so a session can be read back and
# asked where it went. Feeds the `uso` skill. Never blocks: always exits 0.
#
# Columns: ISO date, tool, detail. Detail is the command for Bash, the path for a
# file tool, the pattern for a search, the agent type for a dispatch.

log="${CLAUDE_PROJECT_DIR:-.}/.claude/usage-log.tsv"
input=$(cat)

read -r tool detail <<<"$(printf '%s' "$input" | python3 -c '
import sys, json

try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = d.get("tool_name", "?")
i = d.get("tool_input", {}) or {}
detail = (
    i.get("command")
    or i.get("file_path")
    or i.get("pattern")
    or i.get("subagent_type")
    or i.get("skill")
    or i.get("url")
    or ""
)
print(tool, " ".join(str(detail).split())[:400])
' 2>/dev/null)"

[ -n "$tool" ] && printf '%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$tool" "$detail" >> "$log"

exit 0
