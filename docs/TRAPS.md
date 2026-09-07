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

### RNF-09 has one measurable shape, and it is not `next dev`

`check-http.ts` refuses the RNF-09 verdict unless **two** preconditions hold, and it says which one
failed rather than passing quietly: the measured user must own a year of movements, and
`HARNESS_TARGET` must name what is being served. `dev` is accepted as a label but is documented in
the file itself as **not the requirement's subject** — `next dev` compiles a route on demand, so the
number measures the compiler as much as the query plan.

**The first real verdict, 2026-09-07:** `npm run build`, `npm start`, then
`HARNESS_TARGET=production npm run check:http` with no other lane running — **1118 ms median against
the 2000 ms budget, over 4017 movements** (1098, 1103, 1118, 1131, 1152). 65 pass, 0 fail, 0 skip.

For contrast, the same suite against `next dev` on the same tree and the same data read 1280-1296 ms
with an outlier at 4121 ms. Dev is not merely slower; it is noisier, and the outlier is the compiler.

**Two things that will waste a session if you do not know them:**

- **The measured identity's ledger empties.** It read 4017 movements at one point in the session and
  **2** an hour later, so the suite skipped on the other precondition. `npm run seed:year` is
  resumable — it counts what is already there and writes only the difference — so re-running it is
  cheap and always the right move when H63 skips.
- **`seed:year` can die at `57014` mid-run** inside `private.set_transaction_currency()`. That is the
  8 000 ms `statement_timeout` from `db/session.ts` hitting a slow moment on the remote pooler, not a
  defect that grows with row count: the run that died at 3328 of 4015 resumed and finished the
  remaining 687 in 41 s. Re-run before investigating.

### One database, many branches

A migration applied from any branch is applied for everyone, immediately, including branches
whose schema files know nothing about it. Never apply one to reach a proof.

**What it costs, measured 2026-09-07.** A lane renaming `debt_statements` to `account_statements`
applied its migration while it still had files to edit. For as long as that gap stayed open:

- **13 e2e specs died on `relation "debt_statements" does not exist`** — 17 red out of 178 passed, in
  a run that took 17,9 minutes and had to be thrown away whole. The suite was measuring a branch that
  had not changed and was green an hour earlier.
- **`scripts/harness/fixtures.ts#purgeIdentity` broke for every identity on the database**, on every
  lane, because it names the old table. No lane could clean up after itself.
- A validator on an unrelated branch spent part of its run root-causing the drift before it could
  attribute its own failures.

**So: generate the migration early, apply it last.** Finish every file the rename touches, get
typecheck and lint clean, and only then apply — as the last act before the commit. The window in
which the schema is ahead of the tree is a window in which no suite anywhere means anything.

**And two lanes generating at once collide on the number.** Both took `idx 43` the same afternoon and
both applied. Renumbering afterwards is safe — drizzle matches on the SQL's hash, so keep the entry's
`when` untouched, rename the file, the tag and the snapshot, and the database still reads it as
applied — but the merge conflicts in `meta/_journal.json` and someone has to notice before it does.

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

**Updated 2026-09-06.** `audit_log` sits at 105 971 rows, 110 MB, of a 136 MB database. 75
identities are registered in `harness.identities` (72 `ephemeral`, 3 `shared`) after
`harness:adopt` swept 70 legacy orphans into the registry in one batch. Two commands prune this
pool now: `npm run harness:census` counts it, `npm run harness:reap` drops every dead run's
identities and settles their audit trail. `npm run harness:adopt` is what brings a legacy,
never-registered `auth.users` row into either command's reach in the first place — before it,
neither can see the row at all.

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

### A harness row is proved by `harness.identities`, never a pattern

An email pattern and a `created_at` window both fail as an ownership test: every orphan's
`created_at` reads null, and `createUser()` puts no lane number in `harness-<uuid>@example.invalid`
— neither predicate can tell a live lane's fixture from a dead one's. `harness.identities` is the
one proof: a row there names an identity, `harness.runs` names the run that made it live or dead.
Query the registry. Never `auth.users` by pattern or by age.

### A claimless delete writes an audit row no purge can ever name

`private.capture_audit()` stamps `actor_user_id` from `auth.uid()` and `owner_user_id` from the
deleted row's own `owner_user_id` column. A delete issued with no settled claim, on a table that
carries no `owner_user_id` of its own, lands both columns null — and a null-keyed row matches no
purge that names a user.

52 294 both-null rows exist, measured 2026-09-06: 51 088 `DELETE`, 1 153 `INSERT` (the
recurring-rule generator, RF-30/RF-45 — it only inserts and never claims, left alone by design), 53
`UPDATE`. Corrects the plan's earlier 51 954: the set keeps growing while it is read, so it is a
count, not a fact that sits still. Settle claims (`asOwner`/`asUser`) before every harness delete.

### A table with no `owner_user_id` can never own its own delete

`transaction_splits`, `installment_lines`, `goal_contributions`, `group_members`, `groups`,
`debt_terms`, `account_statements`, `installment_plans`, `transaction_labels` and `app_users` all carry
no `owner_user_id` column. Generalizes past `transaction_splits`: a child table without one produces
an unattributable audit row on every delete that runs with no settled actor claim, no matter who
owns the parent row it hangs off.

### `app_users` is `RESTRICT` from four tables — one untracked row throws for its owner

`accounts`, `transactions`, `planned_payments` and `recurring_rules` are `ON DELETE RESTRICT`
against `app_users` (confirmed against `pg_constraint`). Deleting a user before every row it owns is
gone raises `23503`. A loop over several identities sharing one `try` fails closed for every
identity still queued, not only the one that owns the untracked row. `fixtures.ts`'s `cleanup()`
gives each identity its own `try`/`catch` for exactly this — copy that shape in any new delete loop
that spans more than one identity.

### `registeredIdentities(sql, "shared")` reads every lane, not just its own

`harness.identities` carries no lane column, and a `shared` row hangs off no run by its own `CHECK`
— the query is global by construction. A `cleanup()` that purged every row this call returns would
wipe every other lane's shared trail on every run. Scope the caller to the lane's own identity
before deleting anything it returns.

### A run that leaked must not stamp `finished_at`

`harness:reap` finds dead runs by `finished_at is null` and a stale heartbeat. A run that stamps
`finished_at` on its way out is invisible to the reaper forever after, leaked rows included.
`cleanup()` skips `closeRun` on a partial failure by design — leave a failed run open so a later
reap can still find it.

### `harness:adopt` blocking on its own run is the feature

Its run is created live and is the quarantine marker: for 30 minutes after one batch, both a second
`harness:adopt` and a `harness:reap` are refused. Not a bug to route around — exempting `adopt`'s
own run from the interlock would let a second batch register while the first is still quarantined.

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

### Supavisor overwrites `application_name`

A pooled connection cannot name itself. Supabase fronts both endpoints with Supavisor, and it
replaces whatever the client sends with `Supavisor` before the backend sees it — on the transaction
pooler (`:6543`, `DATABASE_URL`) and on the session pooler (`:5432`, `MIGRATION_DATABASE_URL`) alike.
The connection does not even read back its own value:

```
connection: { application_name: "harness:probe:9" }
select current_setting('application_name')  →  Supavisor
select application_name from pg_stat_activity where pid = pg_backend_pid()  →  Supavisor
```

Measured 2026-09-06 against both URLs in `.env.local`. Other services that connect directly keep
their own names, which is what makes this look like a client bug when it is not.

**So `pg_stat_activity` cannot answer "is another harness process on this database right now".** The
plan for the harness registry had two commands interlock on exactly that, and neither could ever have
fired. `harness.runs` answers it instead: `finished_at is null` and `heartbeat_at` inside 30 minutes,
which is the predicate `harness_runs_live_idx` exists for. Set `application_name` anyway if a log
somewhere wants it; never query it.

### `void sql`...`` in postgres.js never runs the statement

`postgres.js` builds a lazy `Query`. It dispatches on `.then`, `.catch` or `.execute`, so `void
sql`update ...`` type-checks, lints clean, and sends nothing at all. Found on 2026-09-06 in the
registry's 30-second heartbeat: `heartbeat_at` never advanced and the failure was silent in both
directions — no error, no row change. `.catch(() => {})` is enough to dispatch it, and is what a
fire-and-forget statement wants anyway.

### Unconfirmed: claims may survive a connection through the pooler

**Not reproduced in a real suite, and not root-caused. Written down so it is not lost, not so it is
believed.** On 2026-09-06, three ad-hoc probe scripts — fresh connections, nothing open in
`pg_stat_activity` — reproducibly saw a `DELETE`'s `auth.uid()` resolve to **whichever identity an
earlier, unrelated script in the same shell had last settled claims for**, even though
`current_setting('request.jwt.claims', true)` read back empty on the same connection immediately
before the statement.

Ruled out: an open transaction, a shared connection object, a stale import. **Leading suspect is
Supavisor reusing a physical backend across logical connections in transaction pooling mode.**

It did **not** reproduce inside the e2e suite's single persistent connection, and no proof in
`private/reportes/datos-modulo-5.md` depended on it.

**Why it matters if it is real:** «prove a policy by driving it» assumes the identity you settled is
the identity Postgres sees. If a claim can outlive its connection, a policy test can pass under the
wrong identity and prove nothing. Chase it with two scripts and one connection string before
trusting any single-statement identity swap again.

### A trusted-pointer check turns `on delete set null` into a refusal

Found 2026-09-07, driving it on the shipped `ingest_merchants` and on the day-old
`ingest_counterparties`. Both pair a nullable pointer with a check that ties it to a state:

```
trusted_category_id  references categories(id) on delete set null
check ((state = 'trusted') = (trusted_category_id is not null))
```

Deleting the referenced row nulls the pointer while `state` stays `'trusted'`, so the check fires and
**the delete is refused**, not cascaded:

```
delete from categories where id = <a trusted merchant's category>
  -> 23514  ingest_merchants_trusted_category_matches_state
```

Measured the same way on `ingest_counterparties.trusted_account_id` against `accounts`. Use a
transaction-free row to see it: an account or category with movements is refused first by
`transactions_*_fk` (23503), which hides the real defect.

**RF-63 promises category CRUD and RF-94 built the memory; the two collide and no suite caught it**
because every test deleted an identity, never a single category a trusted pattern happened to name.

`on delete set null` is only safe where nothing else asserts the column is non-null. Where a state
column mirrors the pointer, the state has to move with it — cascade the row, or demote it in a
trigger. Never pair the two and assume the FK wins.

### One-sided is not "waiting for a counterparty"

Found 2026-09-07 measuring Module 16 of `plan-modelo-real.md` before merging it. The plan asked to
widen the ledger's `unreviewed` filter to "any movement waiting for a person", reading a null account
leg as the signal. Counted on the real database:

```
reviewed_at null and recurring_rule_id not null   (before)  ->     3
reviewed_at null and (generated or one-sided)     (after)   -> 8 277
                                       total transactions   -> 8 462
```

**RF-17 makes every income and every expense one-sided by construction** — an income names only a
destination, an expense only a source — so the predicate means "is not a transfer", and the review
queue swallows 98 % of the ledger.

`reviewed_at` does not separate them either: it is stamped only on generated movements, so every
hand-recorded expense has carried a null there since the first one. `external_ref` does not separate
them either — it is set on all 8 462 rows.

**Nothing in the model distinguished "one-sided because it is an expense" from "one-sided because the
reader could not tell."** That mark had to be added, not derived. Before widening any queue's
predicate, count what it will hold afterwards on real rows; a predicate that reads correct in prose
can still name almost everything.

### An unreferenced `SELECT` CTE is free to never run

Found 2026-09-07 building Module 13, by watching `ingest_counterparties` stay empty with no error
raised. Postgres guarantees a **data-modifying** CTE executes whether or not anything reads it. It
makes no such promise for a plain `SELECT` CTE: one nobody references may be pruned and never run.

So this learns nothing, silently:

```sql
with updated as (update transactions set ... returning id),
     learned as (select private.remember_counterparty(...) from updated)
select id from updated          -- `learned` is never referenced, so it may never execute
```

and this does the work:

```sql
select updated.id from updated join learned on true
```

**A function call parked in a `SELECT` CTE for its side effect is not a write the planner has to
respect.** Join it into the final select, or make it a data-modifying statement. The failure is
silent — no error, no row, just a side effect that did not happen.

### A schema rename leaves the trigger functions behind

Found 2026-09-07 moving all 24 tables from `public` to `finances`. `ALTER TABLE ... SET SCHEMA`
carries the table's indexes, constraints, owned sequences and all 95 RLS policies with it, because
each of those is stored as a parse tree that points at an OID. **A function body is not a parse
tree. It is text.**

So the 37 functions in `private` kept naming `public.audit_log`, `public.accounts` and the rest,
and every one of them runs `SET search_path TO ''` — the setting that makes a security-definer
function safe is exactly the setting that denies it any fallback. The first suite aborted on
`relation "public.audit_log" does not exist`, and the app would have done the same on the first
write.

The fix is `CREATE OR REPLACE FUNCTION` for each one, generated from `pg_get_functiondef` so the
definition that ships is the definition that ran. The OID survives a replace, so no trigger has to
be re-pointed.

**Two things to check before rewriting anything.** `realtime.apply_rls` and
`realtime.build_prepared_statement_sql` name `public.notes`, which is Supabase's table, not yours:
a blind `public.` → `finances.` sweep across `pg_proc` breaks Realtime. Filter by the schema you
own, then prove the negative — no function outside it names a table of yours.

Nothing in the repository points at this. `pg_proc` is the only place the coupling is visible, so
neither typecheck nor a grep over the tree finds it. Only driving the database does.

### `Translator.availability()` hangs forever in Playwright's Chromium

Chromium 151.0.7922.34, the build Playwright ships today, exposes a native `Translator` global. It
is not the absent global the reading plan assumed. Calling `Translator.availability()` in headless
never settles: it neither resolves nor rejects, so an `await` on it hangs the page for the life of
the run.

`deviceTranslatorState()` wraps the call in a try/catch, which catches a throw and does nothing at
all for a promise that never settles. A timeout is the only thing that saves it.

So any Playwright spec that loads a screen calling `deviceTranslatorState()` must stub
`window.Translator` — delete it for the unsupported path, or inject a fake that settles — in an
`addInitScript`, before the page script runs. A spec that forgets hangs on page load with no error.

Measured 2026-09-07 while validating the reading app's translate module. The module's own checks
pass because every one of them either deletes the global or injects a fake that settles; the real
global was only reached by a bare, un-mocked call, which timed out.

### An explicit `--port` in a `dev` script silently ignores `PORT`

`apps/reading`'s `dev` script read `next dev --port 3100`. A flag on the command line beats the `PORT`
environment variable, so `PORT=3103 npm run dev -w apps/reading` bound **3100** — lane 1's port — and
said so only in a line nobody reads. Two lanes hit it the same afternoon; one bound another lane's
port and had to kill the process it did not own.

Nothing fails loudly. The server starts, the suite runs, and the lane quietly drives another lane's
app. `EADDRINUSE` is the lucky outcome, because at least it stops.

The script now reads `next dev --port ${PORT:-3100}`: npm runs scripts through a shell, so the default
still holds for lane 1 and `PORT` works everywhere else. Measured 2026-09-07: `PORT=3105` binds 3105,
unset binds 3100.

A lane's port belongs to the lane. A script that pins one takes it from whoever runs it next.

### A dependency declared on a branch is not installed by merging it

Module 3 added `fast-xml-parser` to `apps/reading/package.json` and to the lockfile. Nobody ran
`npm install` in the main checkout afterwards, so the package was never on disk there. Merging the
branch changed the manifest, not `node_modules`.

`worktree.sh` hardlinks `node_modules` from the main checkout, so **every lane born after that
inherits the same hole**. The lane whose worker happened to run `npm install` was green; the main
checkout and every other lane were red with `TS2307: Cannot find module 'fast-xml-parser'`, plus a
downstream `TS7006` implicit-any from the callback whose types went missing with it.

The failure blames the wrong file. `scripts/build-dictionary.ts` typechecked clean in its own lane and
under its own validation, then read as broken on `integracion` — so the module that landed it looks at
fault when the checkout is what is stale.

Run `npm install` at the root after merging a branch that adds a dependency, before opening a lane
from it. `git status` stays clean when the lockfile was already correct, which is the tell that the
manifest was never the problem.

Measured 2026-09-07.
