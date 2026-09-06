# Traps

What has already cost this project a day, and how each one was found. Every entry names the
file, the measurement and the date. Read the ones that touch what you are about to write.

Working rules live in `AGENTS.md`. Session state lives in `private/handoffs/`. This file
holds only what a person could not guess from the code.

## Drizzle

### An embedded column renders bare in a projection

Never write `${table.id}` inside a `sql` fragment that lands in a `.select({...})` projection.
Drizzle qualifies an embedded column in `WHERE` (`"transactions"."id"`) but renders it **bare**
in the projection of a single-table select. Postgres binds that bare name to the innermost
relation owning an `id`, the predicate becomes a self-comparison, and the planner hoists it
into an `InitPlan` — one constant for the whole result set. No error, wrong answer.

Live in production 2026-08-30: both jsonb subselects in `listTransactions` were uncorrelated,
so **every listed movement returned `splits: []` and `labels: []`**. Fixed in `be0f053`.

- Bind a qualified literal once and reuse it: ``const outerId = sql`"transactions"."id"` ``.
- Prove it with `.toSQL()` then `EXPLAIN (VERBOSE)`. The outer reference must plan as a
  `SubPlan` naming the outer table. **An `InitPlan` is the bug.**

### `.insert()` names every column, including the defaults

`tx.insert(table).values({...})` emits *every* column of the table, filling the unset ones with
`default`. Under `authenticated`, whose grants are column-scoped, that raises `42501`. Use
`insertRow`; the lint rule bans the builder.

### An array binding is not an array

Drizzle expands a JS array inside a `sql` template into a parenthesised comma list, so
`unnest(${cutOffs}::date[], …)` reaches Postgres as `unnest(($2,$3,$4)::date[], …)` and raises
`42846 — cannot cast type record to date[]`. Found 2026-09-02 in `db/queries/debt-statements.ts`;
the fix was one `jsonb_to_recordset` parameter instead of three array casts. It survived because
the harness only ever called the function on an account with no statements — the empty-array path.

## Postgres

### Widening a `returns table` shadows the columns below it

Every name in a plpgsql `returns table(...)` becomes an OUT variable in scope for the whole body.
Adding one shadows any column of that name referenced unqualified inside, and under
`plpgsql.variable_conflict = error` the function raises **`42702`** at runtime — never at `CREATE`.

Migration `0012` widened `private.resolve_webhook_credential(text)` with the credential's `id`.
The body had three `where id = v_cred.id` clauses, so **every token resolution started raising**
and the webhook ingest was dead on the remote database. Repaired by `0013`.

Audit the *whole* body for bare references to every OUT name, and run `db:check-rls` as a
regression whenever a migration replaces a function.

### The live database does not equal the migrations

Found 2026-09-02 validating migration `0030`. In `drizzle.__drizzle_migrations`, five rows match
no current file hash, and four journal tags have no applied row — those SQL files were edited
*after* being applied. Seven policies on `transaction_splits` and `transaction_labels` exist on
the database and in no snapshot. **A rebuild from the migrations will not equal production.**

### One database, many branches

A migration applied from any branch is applied for everyone, immediately, including branches
whose schema files know nothing about it. Never apply one to reach a proof.

### An unscoped locator finds both bands at once

The desktop layout is additive: a screen keeps its mobile subtree and gains a sibling, so **both live
in the DOM at every width** and only one paints. Every `getByText` or `getByRole` written without a
scope resolves two nodes and the assertion dies on strict mode. Six specs broke on this across the
slice — `accounts`, `members`, `inbox`, `reports`, `settings`, `destructive`.

**The cheap way out, found by module 39 on 2026-09-06 and better than the band trick that preceded
it:** Chromium keeps a `display: none` subtree **out of the accessibility tree**, so a `getByRole`
locator is already viewport-safe and needs no scoping at all. Reach for a role locator first; scope
to a band only when no role names what you need.

Two things a role locator still cannot see through, both measured the same day:

- A `VisuallyHidden` count concatenates into a row's accessible name. The inbox sidebar row stops
  matching by name the moment a delivery is queued. Locate it by `href`.
- `VisuallyHidden` clips a `Dialog.Title` to a pixel rather than dropping it, so it counts as visible
  and `.filter({ visible: true })` cannot tell it from the form's own heading.

The precedent for scoping, when a role will not do: `5c2017c` and `de92b31` on `e2e/accounts.spec.ts`,
`529d0e5` on `e2e/inbox.spec.ts`.

### The audit screen cancels itself once the trail is large

`/es/settings/audit` runs a query linear in the rows the caller may read, and Postgres cancels it
at the 8 000 ms `statement_timeout` in `db/session.ts:68`. The render throws, `error.tsx` replaces
the screen, and **the response is still 200 with no table** — so it reads as missing content, not
as an error. `listAuditLog` and `getAuditFilterOptions` (`db/queries/audit-log.ts`) both walk the
same scan, so `check:queries` cancels either one under the same load, intermittently — sqlstate
`57014`, not a regression in whatever ran beside it.

Measured 2026-09-05: Seq Scan → RLS filter → `WindowAgg` over every readable row. The three-branch
`OR` of `audit_log_select_scope` is what forbids the index. Half the table carries a null actor
and a null owner, unreadable by anyone and still walked by the scan, so purging trims the
`WindowAgg` and not the scan. **The fix is the policy, not the size.**

**What keeps feeding it, measured 2026-09-06.** The CI runs the full e2e suite on **every push and
every pull request** — `E2E_IN_CI` has been `true` since 2026-09-05 20:25 — and it drives **the same
remote database the lanes drive**. Proven, not inferred: the runner's own identity
`harness-member-9@example.invalid` sits in the database `.env.local` points at
(`aws-0-us-east-2.pooler.supabase.com`), created 2026-09-05 15:27. `ci.yml` isolates the run **by
identity** (`HARNESS_LANE=9`), never by database, so it never touches a lane's rows — but every run
still grows `audit_log`, which is the load this trap feeds on. **A push makes the next run likelier
to go red.** Two CI runs went red on 2026-09-06 for exactly this test, `[mobile]
settings.spec.ts:117`.

Turning it off is one command, and it is the switch that also decides which database CI seeds and
purges: `gh variable set E2E_IN_CI --body false`.

**And the table of identities only grows.** 62 rows matched `harness-%` in `auth.users` on
2026-09-06; most are `harness-<uuid>@example.invalid` left by old runs. Nothing prunes them.

**Closed 2026-09-06, the scan half.** The `OR` was never the whole cause: `owner_user_id` and
`group_id` each already carried a partial index, but `actor_user_id` carried none. One indexable
branch missing a supporting index is enough to make Postgres refuse a `BitmapOr` for the *whole*
`OR` and fall back to a Seq Scan with a Filter — the plan measured above. Migration `0036` adds
`audit_log_actor_user_id_idx` (partial, `where actor_user_id is not null`, mirroring the other two).
No policy text changed. Measured after, real `listAuditLog`/`getAuditFilterOptions` SQL, three real
identities (a 20%-of-the-table CI harness account, an 84-row ordinary owner, and a stranger with
zero rows): every plan now reads `BitmapOr` of three `Bitmap Index Scan`s into a `Bitmap Heap Scan`,
never `Seq Scan on audit_log`. Warm-cache execution time: 200–380 ms against the 8 000 ms budget,
for every identity tried, the CI account included. `check:queries` Q91/Q92 and `db:check-rls`
129–132 (the audit-viewer identity-swap: owner, group member, actor, stranger) all pass under
`HARNESS_LANE=2`.

**One rewrite tried and discarded, same session.** The group branch, `group_id is not null and
private.is_group_member(group_id)`, still walks every group-scoped row (13 500-ish of them) on a
`Bitmap Index Scan` and rechecks the function per row — cheap today (that recheck is most of the
200–380 ms above) but it grows with total group-scoped rows, not with the caller's own groups.
Rewriting it as `group_id in (select group_id from group_members where user_id = auth.uid() and
archived_at is null)` tested beautifully in isolation — a `Nested Loop` off `group_members_user_id_
idx` into `audit_log_group_id_idx`, sub-millisecond — but landed in the full policy (migration
`0037`) it made things worse, not better: `in` compiles to `= any(hashed SubPlan)`, which cannot
join a `BitmapOr` with the other two branches, so Postgres dropped the *entire* `OR` back to a
`Seq Scan` with a Filter, timing out at `57014` for two of the three identities tried. Reverted in
`0038`, same session, before either landed on a branch anyone else reads. **The scan is closed; the
per-row function recheck on the group branch is not, and is a plan away, not a size away, if the
group-scoped share of the table keeps growing.**

## Next

### A `loading.tsx` makes every `notFound()` under it answer 200

A `loading.tsx` puts a Suspense boundary over its whole segment. When a fallback renders, the
server must commit to `200 OK` to start streaming, so a later `notFound()` cannot change the
status — it injects `<meta name="robots" content="noindex">` instead. Same for `redirect()`,
which becomes client-side. Sources in `node_modules/next/dist/docs/`: `streaming.md` §"The HTTP
contract" and `loading.md` §"Status Codes".

`loading.js` wraps `not-found.js`, `page.js` and nested layouts — **not** the layout of its own
segment. Here, group-only routes are refused in `(app)/layout.tsx`, above the boundary.
`/movements/[id]` still soft-404s, asserted as H41 in `scripts/check-http.ts`.

### `next typegen` races the dev server

Running `npx next typegen` while a `next dev` server is up corrupts `.next/dev/types/routes.d.ts`
and `validator.ts`: both processes write the same files and the result is spliced mid-line. It
surfaces as exactly two bogus `TS1128` in generated files nobody edited. Stop the server, remove
the directory, regenerate.

## The harness

### Three layers plus the policies

| Command | Proves |
|---|---|
| `npm run db:check-rls` | Every policy, grant and trigger, driven as a real user |
| `npm run check:queries` | Every query function, its round trips and its refusals |
| `npm run check:http` | Every route's status, and the RNF-09 budget |
| `npm run check:e2e` | The screens, at 1280 and at 360 |

`TSX_TSCONFIG_PATH` stubs `server-only`. The session is minted from `auth.one_time_tokens`, so no
mailbox is needed.

### A new desktop table reddens the screen's landed specs

A dense desktop table renders every row's text into the DOM **alongside** the phone's cards.
`display: none` hides it from a person and from `getByRole`, but **not from `getByText`**, which
ignores visibility — so every landed spec locating a row by its bare name hits two nodes and dies
on strict mode. Cost on 2026-09-04: 26 red tests across four assignments.

Scope the locator to the band the width draws (`.filter({ visible: true })`, or split by
viewport), as `e2e/debts.spec.ts` already did. **Only split by viewport if the other width keeps
an assertion of its own** — a viewport that turns a check off is a `test.skip` under another name.

### The fixture fills every screen

`npm run seed:demo` seeds 5 accounts, ~420 movements over 10 months, 6 budgets, 4 goals, 5 planned
payments, 4 recurring rules, card terms and 9 statements. Idempotent and reversible. **Validating a
table against an empty database proves nothing.**

### A stall in the remote database reads as missing content

Three times on 2026-09-05, a trivial statement crossed the 8 s `statement_timeout` — a three-row
insert, and a `categories` select on a screen that renders in 640 ms. The page answers 200 with
the error boundary and the spec says it could not find the row. **Look for `57014` in the dev
server log before touching a locator.**

### `npx playwright test` cannot reach the app

The binary reads no `.env.local`, so it starts without `HARNESS_BASE_URL` and dies on `Invalid URL`
before a single spec runs. `check:e2e` works because it is `node --env-file=.env.local
./node_modules/@playwright/test/cli.js test`. **Run one spec by extending that line, never by
reaching for `npx`:**

```
HARNESS_LANE=2 HARNESS_BASE_URL=http://localhost:3001 \
  node --env-file=.env.local ./node_modules/@playwright/test/cli.js test e2e/accounts.spec.ts
```

### `pesosOf` throws the sign away

The helper in `e2e/accounts.spec.ts` strips `\D`, which takes the U+2212 minus along with the
currency symbol. A sign asserted through it passes with the sign and without it. **Assert a sign
against the raw `innerText`.**

### Dropping a worktree burns the report inside it

`private/` is in `.gitignore`, and an ignored path is **not shared between worktrees**: every lane
has its own. A worker writes its long account to `private/reportes/<branch>.md` in its own lane, so
`git worktree remove ../finances-app-l<n> --force` deletes it with the directory. Nothing in git
holds a copy, and the branch merging changes nothing — the file was never tracked.

On 2026-09-05 three reports died that way, minutes after their branches merged: the accounts of
multicurrency modules 23, 24 and 28, each carrying the measurements behind a PASS.

Copy it out before dropping the lane:

    cp ../finances-app-l<n>/private/reportes/*.md private/reportes/

### A hook committed 644 dies on the next checkout

Git tracks the execute bit. A hook that works locally because the shell that wrote it left `+x` on
disk is stored `100644` all the same, and the next branch switch rewrites it without the bit. On
2026-09-05 both hooks went dead that way at a checkout: `context-watch.sh` reported `Permission
denied` because the harness surfaces a `Stop` hook's failure, and `log-usage.sh` said nothing at
all and simply stopped appending — six minutes and about a dozen tool calls missing from
`.claude/usage-log.tsv` before anyone noticed. **`chmod +x` fixes the disk, not the repository:**

```
git update-index --chmod=+x .claude/hooks/*.sh
git ls-files -s .claude/hooks/    # 100755, not 100644
```
