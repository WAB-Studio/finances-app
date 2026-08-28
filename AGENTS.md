<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Shared fund app

Contract: `docs/SPEC.md` §1. Model and invariants: §2. Stack: §4. Flows: `docs/FLOWS.md`. Interface: `docs/DESIGN.md`.

## Working here

- Run the `orchestrator` skill to develop. It dispatches `planner` and `worker`.
- Keep plans in `private/`.
- Ship one slice at a time.
- Use the dev server already running. Never kill it.
- Take `Another next dev server is already running` as the answer. Stop.

## Requirements

- Never renumber an RF or RNF. Never reuse a retired number.
- Take the next free number for a new code. Leave the holes.
- Edit wording that leaves the built behaviour identical.
- Retire the code when the behaviour changes. Open a new one for the new behaviour.
- Move a retired code to `### Retired` in `docs/SPEC.md` §1, with its text, its date and its successor.
- Keep a retired code's tick.
- Ask the user before retiring. Never retire on your own.

## Code

- Store money as integer cents. Floating point is forbidden.
- Derive balances from movements. Never store them in a column.
- Derive the transaction type from the accounts involved.
- Revoke ALL from `anon`, `authenticated` and `service_role` in every migration that creates a table. Supabase grants them at `CREATE TABLE`.
- Prove a policy fires. Never assert it from the migration.
- Count round trips to Postgres, not queries. Every one pays the full latency to the pooler.
- Settle the session in one statement. Never one statement per `set_config`.
- Fan a screen's queries out with `Promise.all`, the fund guard included. Never chain the awaits.
- Validate on the server with the same Zod schema that validates the form.
- Move every interface string into next-intl. Hardcoding is forbidden.
- Compose a screen from `components/ui` and its props. Never write a utility class outside it.
- Add a prop to the primitive when a screen needs a variant. Never patch one from outside.
- Write interface text a person acts on. Cut text that only explains.
- Install only from §4. Discard the do-not-install list.
- Write code and identifiers in English. Write user-facing copy in the user's language.

## Comments

- Say what the code does not. Skip the rest.
- Keep them to one idea. A wrapped line is still one.
- Never restate the line below.
- Never log a change, a date, an author or a ticket.

## Writing skills, agents and this file

- Command in verbs. Cut the rationale.
- Cut every sentence that does not change what someone does.
- List. Never paragraph.
- State the rule. Avoid the conditional.
- Keep it short enough to read once.
