#!/usr/bin/env bash
# Stop hook — tells the session to close its handoff once the window is large.
#
# The size is an estimate: the transcript on disk is bytes, not tokens, and it
# keeps what compaction already dropped. Four bytes to a token is close enough to
# fire a warning and never close enough to quote. Fires once per session.
#
# Threshold: HANDOFF_TOKENS, default 400000. Never blocks: always exits 0.

input=$(cat)

python3 - "$input" <<'PY'
import json, os, sys
from pathlib import Path

LIMIT = int(os.environ.get("HANDOFF_TOKENS", "400000"))

try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)

path = d.get("transcript_path") or ""
session = d.get("session_id") or "unknown"
if not path or not Path(path).exists():
    sys.exit(0)

tokens = Path(path).stat().st_size // 4
if tokens < LIMIT:
    sys.exit(0)

marker = Path(os.environ.get("TMPDIR", "/tmp")) / f"claude-handoff-warned-{session}"
if marker.exists():
    sys.exit(0)
marker.touch()

print(json.dumps({
    "hookSpecificOutput": {
        "systemMessage": f"Contexto ~{tokens // 1000}k tokens: toca cerrar handoff.",
        "additionalContext": (
            f"The window is around {tokens // 1000}k tokens, past the {LIMIT // 1000}k mark "
            "the user set for closing a session. Finish the step in hand, then run the "
            "`handoff` skill to close: push every branch, verify no Claude attribution, write "
            "private/handoffs/, and tell the user the path so they can open a new chat. "
            "Do not start new work. The figure is an estimate from the transcript's size on "
            "disk, so report it as approximate."
        ),
    }
}))
PY

exit 0
