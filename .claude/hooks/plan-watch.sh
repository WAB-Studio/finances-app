#!/usr/bin/env bash
# Stop hook — names the next unticked module when a plan is open.
#
# A plan of 29 modules with no state is a plan that lives only in one session's
# head. On 2026-09-05 a wave landed, the report read complete, and the turn ended
# with nothing dispatched: the user had to ask what was happening. Nothing in the
# repo knew a module was pending, so nothing said so.
#
# Reads the newest `private/plan-*.md`, finds the first `- [ ]` module line, and
# says it. Silent when every module is ticked, when no plan is open, or when the
# session is already being told to close its handoff. Never blocks.

input=$(cat)

python3 - "$input" <<'PY'
import json, os, re, sys
from pathlib import Path

root = Path(os.environ.get("CLAUDE_PROJECT_DIR", "."))
plans = sorted((root / "private").glob("plan-*.md"), key=lambda p: p.stat().st_mtime, reverse=True)
if not plans:
    sys.exit(0)

plan = plans[0]
text = plan.read_text(encoding="utf-8", errors="replace")

# A module line carries its own box: `- [ ] ## 12 — title` is the plan's state.
pending = re.findall(r"^## \[ \] (.+)$", text, re.M)
done = re.findall(r"^## \[x\] ", text, re.M)
if not pending:
    sys.exit(0)

rel = plan.relative_to(root)
nxt = pending[0].strip()
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "Stop",
        "additionalContext": (
            f"{len(done)} de {len(done) + len(pending)} módulos de `{rel}` están hechos. "
            f"El siguiente es **{nxt}**, y nada lo bloquea que vos sepas.\n\n"
            "No cierres el turno con un informe si hay un módulo listo para despachar: "
            "tomalo. Si de verdad está bloqueado, decí en una línea por quién o por qué. "
            "Y cuando un módulo aterrice, marcá su `## [ ]` como `## [x]` en el plan — "
            "un plan sin estado sólo existe mientras una sesión lo recuerde."
        ),
    }
}))
PY
