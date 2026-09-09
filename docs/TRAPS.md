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

### A bound parameter Postgres calls `timestamptz` is floored to milliseconds

`postgres.js` resolves a parameter's wire type from what Postgres describes it as, then serializes
any value bound to OID 1184 through `date.serialize = x => (x instanceof Date ? x : new Date(x))
.toISOString()` (`node_modules/postgres/src/types.js:31`). A JS `Date` holds milliseconds, so the
microseconds Postgres stored are gone before the value ever reaches the wire — string parameters
included, because the string is re-parsed through `Date` on the way in.

```
bound as $1::timestamptz  ->  2026-09-08 22:13:28.721+00     (the value was .721169)
bound as $1::text::timestamptz -> 2026-09-08 22:13:28.721169+00
```

A row compared against its own `received_at` read back this way tests as **greater than itself**.
`ts = $1` returns false for an identical instant; `ts::text = $1` returns true.

Cast from text inside the SQL — `$1::text::timestamptz` — so the parameter travels as OID 25 and
Postgres parses the literal at full precision. Comparing `::text` on both sides works too, and is
what `apps/voyager/scripts/check-sync.ts` does.

Three agents hit this independently the same day, in three different shapes: a row greater than
itself, a `created_at` serialised wrong on the way out, and the download cursor below.

Measured 2026-09-08.

### `now()` is the transaction's clock, so one INSERT stamps every row identically

`now()` is the transaction start time, not the statement's. A batch insert is one statement in one
transaction, so **every row it writes shares one timestamp to the microsecond**. A cursor of the form
`where stamp > $since order by stamp limit N` cannot resume inside that tie, and a batch larger than
the page is a tie that straddles the page boundary.

Measured on `reading.lookups`: 300 rows at T1 and 500 at T2 uploaded as two batches.

- Page 1 returns 500 — the 300 of T1 and **200** of T2. The cursor becomes T2.
- Compared as text, page 2 returns **0**: the remaining **300 rows of T2 never download**.
- Compared through a bound `::timestamptz` the cursor floors below T2 (the trap above), page 2
  returns the **same 500 rows**, and it does so forever — 42 identical pages, with 10 rows uploaded
  afterwards still never reached.

The two are one defect wearing two faces, and which one you get depends on how the cursor is bound:

- **Bound below the tie — infinite duplication.** The `::timestamptz` truncation rounds *down*, so the
  cursor sits strictly under the tied group and `>` re-admits all of it, every page, forever.
- **Bound exactly on the tie — silent loss.** Compared as untruncated text, the cursor *equals* the
  group's timestamp, and a strict `>` on an equal value drops the rest of the tie permanently.

Fixing only the truncation converts the first into the second. Both need the tiebreaker.

Both edges are real and neither is a corner case: any log past one page ties at every batch boundary.
Order and compare on a tuple that is unique — `(received_at, device_id, local_id)` — not on the
timestamp alone. A sequence column looks cleaner and is not free here: `bigserial` needs `USAGE` on
the sequence for the inserting role, and the schema revokes ALL on sequences on purpose.

Neither defect is visible in a test that uploads fewer rows than one page.

Measured 2026-09-08.


### Reading the DOM hides a leak the bytes carry

A cached, server-rendered page can carry one reader's data in its HTML while the client repaints
the screen on hydration. Asserting on `document.body.innerText` then passes on the broken build:
React had already replaced the baked-in email with the signed-out form by the time the check ran.

Measured while proving a service-worker cache leak: `RAW served HTML contains reader email: true`
on the buggy commit, `false` on the fix, with the visible text identical in both.

Assert on the response bytes for anything about what a page *served*. Keep the DOM for what a person
*sees*. A privacy check that only reads the DOM is not a privacy check.

Measured 2026-09-08.


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

`apps/voyager`'s `dev` script read `next dev --port 3100`. A flag on the command line beats the `PORT`
environment variable, so `PORT=3103 npm run dev -w apps/voyager` bound **3100** — lane 1's port — and
said so only in a line nobody reads. Two lanes hit it the same afternoon; one bound another lane's
port and had to kill the process it did not own.

Nothing fails loudly. The server starts, the suite runs, and the lane quietly drives another lane's
app. `EADDRINUSE` is the lucky outcome, because at least it stops.

The script now reads `next dev --port ${PORT:-3100}`: npm runs scripts through a shell, so the default
still holds for lane 1 and `PORT` works everywhere else. Measured 2026-09-07: `PORT=3105` binds 3105,
unset binds 3100.

A lane's port belongs to the lane. A script that pins one takes it from whoever runs it next.

### A dependency declared on a branch is not installed by merging it

Module 3 added `fast-xml-parser` to `apps/voyager/package.json` and to the lockfile. Nobody ran
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

### StrictMode doubles a Worker count in `next dev`, and only there

React 19 under Next 16 double-invokes effects in `next dev`. A hook that creates a `Worker` in an
effect therefore reports **two** creations and two terminations per mount when you count them in dev,
and the honest one per mount against `next start`.

The reading app's `useDictionary` was checked both ways: `created: 4 / terminated: 4` in dev for two
mounted hooks, `created: 2 / terminated: 2` against the production build. Nothing was wrong either
time.

Measure a mount-count, an effect-count or anything else StrictMode touches against `next build &&
next start`, never against `next dev`. Reading it in dev invents a leak that is not there — or hides
a real one behind a number you have already talked yourself out of.

Measured 2026-09-07 while validating the dictionary worker.

### Regenerating a lockfile on one machine drops every other platform's packages

Renaming the two app directories left four stale workspace keys in `package-lock.json`. Deleting the
file and re-running `npm install` fixed them and quietly took **153 packages** with it: 799 entries
before, 646 after. What goes is the optional, platform-specific set — the `@next/swc-*` and
`@esbuild/*` builds for every OS that is not the one you ran the install on. `npm ci` still passes on
that machine and on a CI runner of the same platform, so nothing looks wrong until someone else's
`npm ci` fails on a package the lockfile no longer names.

Rename the entries in place instead. There were six lines: two `"apps/<name>"` keys, two `"name"`
fields and two `node_modules/<pkg>` keys with their `"resolved"` paths. Editing them kept all 799
packages and turned a 14,775-line diff into 16 lines. Then prove it with `npm ci`, which is what CI
runs.

Never regenerate a lockfile to fix a path. `--package-lock-only` does not save you either: it adds
the new keys and leaves the old ones behind.

Measured 2026-09-07 renaming `apps/finances` and `apps/reading`.

### `worktree.sh` derives a suite's base-URL variable from the app's name

The lane script prints an app's commands with `${APP_NAME^^}_BASE_URL`. Rename the app and the
variable it prints renames itself, while the `playwright.config.ts` that reads it does not. After
`reading` became `voyager` the script suggested `VOYAGER_BASE_URL` and the config still read
`READING_BASE_URL`: the command runs, silently ignores the port you gave it and drives the default.
Nothing errors — the suite just points somewhere else.

Grep for `_BASE_URL` when an app is renamed, and rename the variable with it.

Measured 2026-09-07.

### A pipe carries stdout, and a guard that greps a `tee` log never sees stderr

`.github/workflows/ci.yml` captured the reaper's output with `| tee` and then ran
`grep -q '^BLOCKED'` over the file to tell an interlock apart from a real failure. But
`scripts/harness/reap.ts:63` writes `BLOCKED` with `console.error`, and a pipe carries stdout only.
The marker never reached the file, so **every** block fell through to
`::error::… for a reason other than a live run blocking it` — naming the one reason it was not.

The guard had been in the workflow since it was written and **had never once executed**. Nothing
errored; the branch just read as broken whenever another lane held the slot.

Redirect with `2>&1` before the pipe when a guard reads a log. Fixed in `55c7eff`.

Measured 2026-09-07.

### `e2e-remote-db` is a one-slot concurrency group for the whole repository

GitHub holds one run in progress and **one** in the queue per concurrency group. A third arrival
does not queue behind the second: it **cancels** it. Opening a second PR while a first one's `e2e`
is still running therefore kills the first one's queued run, and the PR reads as failed for a
reason that has nothing to do with its diff.

It happened with #30 and #31 on 2026-09-07. Land one PR's `e2e` before opening the next when both
touch the group, or expect to re-run by hand.

### "Keep a retired code's tick" means leave it as it was, not tick it

`AGENTS.md` says to keep a retired code's tick. RL-05 was retired on 2026-09-07 and a decision
document in `private/` said to retire it "keeping its `[x]`". **RL-05 had never been ticked.**
Writing the tick in would have claimed built behaviour that was never built.

The rule preserves the state, whichever state it is. A paper in `private/` is a plan, not a
measurement: check the real one with `git show <base>:docs/SPEC.md`, never against the plan that
sent you.

### A service worker that caches every navigation under a literal key overwrites itself

`apps/voyager/public/sw.js` stored every navigation response under the key `"/"`. A hard load of
`/fuente` therefore replaced the cached shell of `/`, and the next offline visit to `/` served the
wrong page. The existing spec stayed green throughout — it only ever exercises `/`.

Key the cache by the request URL, and bump `CACHE_NAME` so an already-installed client drops the
stale entry. Fixed 2026-09-07, v1→v2.

### A Vercel project's Root Directory does not follow a folder rename

Renaming `apps/finances` to `apps/orbit` and `apps/reading` to `apps/voyager` left both Vercel
projects pointing at paths that no longer exist. The build fails in **2 seconds**, before install,
with `The specified Root Directory "apps/finances" does not exist`, and the commit status reads
only `Deployment has failed` — the reason is visible solely in the build log
(`npx vercel inspect <dpl_id> --logs`).

Production kept serving the last good deploy, so the app looked healthy while `main` had not
deployed since the rename.

Two more things that do not follow the repo: the **Vercel project name** and its **production
URL**. `our-piggy-bank.vercel.app` (orbit) and `reading-neon.vercel.app` (voyager) are the live
hosts; `orbit.vercel.app` and `finances-app.vercel.app` are 404s.

Update Root Directory in Project Settings for every app in the monorepo when one is renamed.

Measured 2026-09-08.

### Renaming an app leaves its build output behind, invisible to `git status`

`git mv` moves what git tracks. `.next/`, `tsconfig.tsbuildinfo`, `.eslintcache` and `next-env.d.ts`
are gitignored, so renaming `apps/finances` to `apps/orbit` left **192 MB** under the old path — and
because `git status` does not list ignored files, the tree read as clean for a day. Only the
checkout that predates the rename carries it; worktrees born afterwards are clean, which is why it
survives unnoticed in the one place you work in most.

Stale `.next/types` under a dead path is also a candidate source of typecheck errors for files that
no longer exist there.

After renaming an app, delete the old directory outright — `git status --ignored` is what shows it.

Measured 2026-09-08: `apps/finances/` held only `.next/`, `tsconfig.tsbuildinfo`, `.eslintcache` and
`next-env.d.ts`, with `git ls-files` returning nothing for that path.

### Concurrent lanes share one remote database, and the flake lands on someone else's branch

Lanes get their own harness identities and seeded rows, so they never fight over data. They do not
get their own Postgres. Every lane, plus CI, pays the same pooler, and load is the one thing lane
isolation does not isolate.

Measured twice on 2026-09-08, with three agents driving the base at once:

- CI's `e2e` on a branch whose diff was **only `.md` files** went red at
  `e2e/destructive.spec.ts:231`: the confirm dialog stayed visible after the delete was clicked,
  `expect(locator).toBeHidden()` timing out at 5000 ms. 215 passed, 1 failed. `main` had closed the
  same suite green fifteen minutes earlier.
- `check:queries` failed `Q89 listAuditLog` with `sqlstate 57014, canceling statement due to
  statement timeout`. The immediate rerun came back 116/0/0.

Neither red named its cause, and both landed on a branch that could not have caused them. Before
chasing a timeout on a diff that cannot explain it, count what else is driving the base:
`npm run harness:census` lists live runs, `gh run list` shows CI. A suite whose assertions are all
green but for one write-path timeout is the shape of contention, not of a defect.

`AGENTS.md` allows three suites at once. Three is what produced both of these.

### Every push enters the one-slot group, not just every PR

The entry above and `AGENTS.md` both frame `e2e-remote-db` as something a second **PR** disturbs. It
is wider than that: **any** push that triggers the workflow takes a place in the queue.

Measured 2026-09-08. Fast-forwarding `integracion` to `main` — a branch update carrying commits
`main` had already tested green — queued a run that evicted PR #37's `e2e` after 8m12s of waiting.
The job's own annotation names it exactly:

    Canceling since a higher priority waiting request for e2e-remote-db exists

`cancel-in-progress: false` does not save you. It stops a new arrival from killing what is *running*;
it does not stop a third arrival from evicting what is *queued*. GitHub keeps one running and one
waiting, and the newest request wins the waiting slot.

The eviction reads as a plain red `e2e` on the PR page. Check the run's ANNOTATIONS before chasing a
diff: `gh run view <id>` prints them, and a cancelled-by-priority run names itself.

Land one thing at a time when the group is busy, and prefer cancelling a redundant run
(`gh run cancel <id>`) over adding another.

**The redundant run is usually your own `integracion` fast-forward.** `AGENTS.md` says to
fast-forward it *before using it*; doing it after every merge instead queues a run over a SHA `main`
has already tested, and that run is what evicts the PR waiting behind it. Measured again 2026-09-08:
three fast-forwards in an afternoon, each one a push run on a SHA identical to `main`'s, and the last
of them held the slot while PR #48 — the only PR of the day that actually needed orbit's `e2e` —
waited in the queue behind it.

Fast-forward `integracion` when you are about to merge into it. Not after every merge to `main`.

### A lane born for one app cannot typecheck the other until typegen runs there

`worktree.sh --app voyager` copies voyager's `.env.local` and nothing of orbit's. The lane is
therefore complete for voyager and cold for orbit: `.next/types` was never generated there, so
`npm run typecheck` at the root fails on `apps/orbit` with 39 errors of the shape
`TS2304: Cannot find name 'PageProps'` and `LayoutProps`. Not one of them names a file the lane
changed.

It reads as a branch that broke orbit. It is a lane that never built orbit. `npx next typegen` in
`apps/orbit` clears all 39, and the artefact is gitignored, so nothing about the branch changes.

Typecheck the app the lane was opened for. Before calling the other app's errors a regression, run
`next typegen` there once and look again — and never with that app's dev server up, which is the
separate race two sections above.

Measured 2026-09-08 validating the voyager lane module in a lane opened `--app voyager`.

### `git diff main` moves under a verification when someone merges

A validator comparing its branch against `main` had a file appear in its diff that its branch never
touched. Nothing was wrong with the branch: `main` advanced mid-verification, because the
orchestrator merged an unrelated PR while four lanes were being checked. A two-dot `git diff main`
asks "how do these two commits differ *now*", so every commit that lands on the base while an agent
works enters its diff and reads as scope the assignment did not have.

Use `git diff $(git merge-base main HEAD) HEAD` for a scope check, or the three-dot `git diff main...HEAD`,
which means the same thing. Both ask "what did this branch add since it forked", and the answer stops
depending on what anyone else merges.

The same applies to `git log`: `git log main..HEAD` is already fork-relative and stays correct, which
is why the authorship check never showed this and the scope check did.

Measured 2026-09-08, with PR #40 landing while three validators ran.

### A green check belongs to a SHA, not to a branch

The same mistake as the entry above, one layer out. `gh pr checks <n>` prints a bucket per check
name, and says nothing about *which commit* produced it. Merge `main` into a branch — or push any
fix — and the old run's verdict keeps showing as the PR's status until the new one reports.

Measured 2026-09-08, twice in one afternoon:

- PR #47's `voyager-e2e` was red, and the branch was green locally. The red belonged to the commit
  before `main` was merged in; the merge was what fixed it. Nothing was wrong with the code.
- PR #50's `voyager-e2e` reported `pass` on `9be9ec5`. The branch head was `dad10ea`, whose run was
  still `pending`. Merging on that green would have landed a commit nothing had tested.

Read the SHA, never the bucket alone:

    gh pr checks <n> --json name,link --jq '.[]|select(.name=="<job>")|.link'
    gh api repos/<owner>/<repo>/actions/runs/<id> --jq '.head_sha, .status, .conclusion'

and compare it against `git rev-parse HEAD`. The same habit that fixes the entry above — compare
against a commit, never against a name — is what fixes this one.

**And verify a push landed.** `git push -q` on a branch with no upstream prints its complaint and
`-q` swallows it. That is how PR #47's stale SHA got there: the merge commit never reached the
remote, and CI dutifully tested what was there. `git push -u origin <branch>`, then compare
`git rev-parse HEAD` against `git ls-remote --heads origin <branch>`.

### `server-only` resolves under Next and nowhere else

Nothing declares `server-only` and `node_modules/server-only` does not exist, yet `lib/supabase/server.ts`,
`packages/supabase-auth/src/claims.ts` and voyager's `lib/session.ts` all import it and every build is
green. Next ships it at `node_modules/next/dist/compiled/server-only` and aliases the bare specifier
itself.

So it works in the app and fails in anything that loads one of those files under plain Node — a `tsx`
harness, a one-off probe, a script outside `next dev`. The error names a missing package and invites
the wrong fix.

Stub it in the harness. Never add it to a `package.json` to make a probe run: the app does not need it
and the declaration would outlive the probe.

Measured 2026-09-08, driving voyager's `lib/session.ts` from a scratchpad harness.

### `db:check-rls` cannot see a change to the settle statement's search_path

A validator mutated `searchPath: "finances, public"` to `"public"` in both call sites of
`apps/orbit/db/session.ts` and ran `db:check-rls` to prove the check discriminated. It stayed green
past assertion 107.

`scripts/check-rls.ts` sets `search_path` on its own Postgres connection config. It never goes
through `db/session.ts`, so nothing it asserts depends on what `settleSessionSql` puts on the wire.
A suite that drives the app does: the same mutation turned `check:queries` solidly red with
`42P01 — relation "..." does not exist` at `Q8`, `Q10`, `Q19`, `Q22`–`Q24`, `Q30`–`Q34`, `Q81`–`Q97`.

Prove a change to the session statement with `check:queries` or `check:http`, never with
`db:check-rls` alone. And when a mutation fails to turn a suite red, say so — the suite may simply
not touch the code you changed.

Measured 2026-09-08 validating orbit's move onto the shared auth package.

### One build failure hides the next

voyager's Vercel build failed on `TS2307` for undeclared dependencies. Declaring them fixed it,
proven both ways in isolated trees. Production stayed red: behind it sat a second failure the first
had masked — five environment variables the app had made **required** (`z.url()`, not `.optional()`)
that the Vercel project did not carry. The build had been dying before it ever reached env validation.

Fixing the first failure proves the build gets further, not that the app deploys. Read the new log
rather than assuming the same cause, and check the deployment itself went green before saying a
build is repaired.

Measured 2026-09-08, on voyager's `reading` project.

### Landing one thing at a time burns the Vercel deployment quota

`e2e-remote-db` says to land one PR at a time, because the group holds one running and one waiting.
Obeying that means many small PRs. Vercel's free tier caps **deployments per day**, and this repo has
**two** projects — orbit and reading — so every push to every branch costs two.

Measured 2026-09-08. Fifteen PRs in an afternoon, each pushed two or three times, each merge a
production deploy on both projects. Both projects hit the cap and every check went red with:

    Deployment rate limited — retry in 24 hours.

**It is not a build failure and nothing is broken.** The limit blocks *new* deployments; what is
already published keeps serving. Verified at the time: both production URLs answered `200` in under
a second while every PR check was red.

What it does cost is real and lasts a day:

- Nothing merged after the cap reaches production until the window resets. `main` moves; the live
  site does not.
- Both Vercel checks are red on every PR for 24 hours and carry no signal at all. Do not chase them,
  and do not let them mask a genuine red — read `typecheck`, `lint` and the two `e2e` jobs instead.

**The fix, and what it costs.** `git.deploymentEnabled` in each app's `vercel.json` takes minimatch
keys, and a branch matching several rules deploys if any one of them is `true`:

    "git": { "deploymentEnabled": { "*": false, "main": true } }

That drops every branch's preview and leaves only the merge to `main`. **It also removes the only
place `next build` runs for orbit.** CI builds `apps/voyager` (`ci.yml:232`) and nothing else: the
orbit `e2e` job starts `npm run dev`, `typecheck` is tsgo and `lint` is eslint. With previews off, an
orbit build breaks at the production deploy, after the merge — which is exactly the shape of the
failure that cost hours on 2026-09-08, where one broken build hid the next. **Add `next build` for
orbit to CI before trusting this.**

The two rules pull against each other: one PR at a time protects the CI queue and spends the deploy
quota. When a day's work is many small landings, batch what can be batched — a docs change and a
trap entry are one PR, not two — and check the URL of a failing Vercel check before believing it:
`upgradeToPro=build-rate-limit` in it means quota, never code.

### Voyager's browser suite reads three false reds against `next dev`

`apps/voyager/playwright.config.ts` carries no `webServer` block: it drives whatever answers on
`VOYAGER_BASE_URL`, defaulting to `:3100`. The port a developer keeps up all day is `npm run dev`,
and the suite is written against `next build && next start` — its own comment says so, and CI's
`voyager-e2e` job builds before it starts the server.

Point it at the dev server and **`install.spec.ts:15`, `url.spec.ts:84` and `url.spec.ts:99` fail**,
31 passed / 3 failed. They fail on any tree, so `git stash` and a re-run on `main` reproduces them
exactly — which reads like proof that `main` is red. It is not. The same commit's `voyager-e2e` ran
the whole suite against a production build and passed in 3 m 20 s.

The three are the states dev cannot produce: the service worker's precache on the install path, and
the history entries the `/?q=` route writes. React's StrictMode double-effect is the same family of
difference and already cost a measurement once — see "StrictMode doubles a Worker count".

Build first, on a port of its own, and leave the dev server alone:

```
npm run build -w apps/voyager
npm run start -w apps/voyager -- --port 3110 &
VOYAGER_BASE_URL=http://localhost:3110 npm run check:e2e -w apps/voyager
```

Never read a local red on this suite as a red on `main` until it has run against a build. Measured
2026-09-08, on module 26.

### `harness:census` is blind to anything that is not `harness%@example.invalid`

Module 14's worker drove `signInWithOtp` against the shared Supabase project while verifying that the
sign-in link answers the same for a registered and an unregistered address. Two real `auth.users`
rows survived, as plus-addressed gmail addresses.

`npm run harness:census` did not move: `ephemeral: 25`, `shared: 16`, 141 MB, the same numbers before
and after. It counts `harness%@example.invalid` and null-email rows and nothing else, so a row whose
email does not match that shape is invisible to it — and `harness:reap` cannot prune what the
registry never saw. **`apps/voyager` had no registry of its own**, so every probe
there is in that position by default.

Until voyager has a registry: a probe that touches `auth` from voyager deletes its own rows in the
same script, or it does not run. Do not trust the census to catch it.

The count in a report is not a measurement either. That worker reported **seven** leaked rows — five
of them were the rate-limit test's addresses, and the 429 fired before Supabase ever created them.
The real number was **two**, found only by querying the table.

Measured 2026-09-08.

### Grepping a leaked secret writes it back into the usage log

`.claude/usage-log.tsv` records every tool call, the command line included. Searching the disk for a
leaked API key therefore logs the search — with the key inside it. The first redaction pass removed
the value and left two fresh copies behind, inside the `grep` and `sed` commands that had just hunted
for it.

Redact on a short anchor (the first six characters plus a greedy tail), never on the full literal, and
verify with `grep -r --no-ignore`: the plain sweep skips gitignored files, which is exactly where the
log lives.

What cannot be cleaned this way: `~/.claude/history.jsonl` and the session's own `.jsonl` transcript.
Rewriting a transcript to hide one's own mistake falsifies the record — leave them and rotate the
credential instead. A secret that reached a chat is rotated, not scrubbed.

Measured 2026-09-08.

### A code cited in a source comment can not exist in `SPEC.md`

A code cited in a comment in the code is not proof the code was ever opened.
`apps/voyager/components/search/search-screen.tsx:42` cites **RL-36**, and the highest code ever
opened in `docs/voyager/SPEC.md` is RL-29.

Grep `RL-[0-9]*` over `SPEC.md` before trusting a number read from a code comment.

Measured 2026-09-08.

## `worktree.sh <n> <rama> integracion` corta de la local, no del remoto

Medido 2026-09-08. `scripts/worktree.sh 3 modulo-12-contrato-foto integracion` resolvió `integracion`
a la rama **local**, que iba cinco commits por detrás de `origin/integracion` porque su checkout
vivía en otro carril y nadie la había adelantado. El carril nació sin el módulo que acababa de
fusionarse, y su worker abrió los códigos siguientes contando desde un `SPEC.md` que llegaba a RL-29
cuando la base real llegaba a RL-34.

**Salió bien por casualidad**: eligió RL-35 y RL-36, que no colisionaban. El razonamiento que escribió
para justificarlo era otro y era falso. Un número correcto por la razón equivocada vuelve a salir mal
la próxima vez.

- `git fetch` y adelanta la base **antes** de abrir el carril, no después.
- Una rama que otro carril tiene sacada no se adelanta sola. `integracion` es la que más lo sufre.
- Rebasa sobre la base real antes de fusionar, siempre que la rama nombre un fichero que otra tocó.
  Aquí `SPEC.md` y `DESIGN.md` chocaron los dos, y el conflicto era la prueba de que el carril estaba
  desfasado — no una molestia.
- Un worker que ve un número que no cuadra con su despacho está viendo esto. Que lo diga y pare.

## Los números de módulo se repiten entre slices, y los informes se pisan

Medido 2026-09-08. `private/reportes/modulo-12-contrato-foto.md` iba a escribirse junto a un
`modulo-12-driver-copia.md` de otro slice, y `modulo-13-proveedores-ia.md` junto a
`modulo-13-cadenas.md`. Cada plan numera desde 1, así que el número solo es único dentro de su plan.

- Nombra el informe por lo que hace, no solo por el número. `modulo-12-contrato-foto`, nunca `modulo-12`.
- Comprueba `ls private/reportes/modulo-<n>-*` antes de escribir uno.

## Copia el informe del carril antes de soltarlo

Medido 2026-09-08. `git worktree remove ../finances-app-l3 --force` se llevó
`modulo-12-contrato-foto.md` sin avisar: `private/` está en gitignore, así que el informe vivía solo
ahí. Sobrevivió porque su contenido estaba en el cuerpo del PR y en `SPEC.md`.

- `cp ../finances-app-l<n>/private/reportes/*.md private/reportes/` **antes** del `worktree remove`.
- Escribe en el cuerpo del PR lo que decide, no solo en el informe. El PR sí viaja en git.

## Reddit bloquea el rastreador de Anthropic

Medido 2026-09-08. `WebSearch` con `allowed_domains: ["reddit.com"]` devuelve
`400 The following domains are not accessible to our user agent`. No es un fallo de la consulta.

- Busca en la web abierta y filtra tú. Las guías agregadoras repiten lo mismo que los hilos.
- Desconfía de lo que digan de límites y cuotas: para este proyecto decían ~1.500 peticiones/día y la
  medición dio **20**. Ver la entrada de la cuota diaria de Gemini.

## Republicar el lienzo con `JSON.stringify` lo deja truncado

Medido 2026-09-09. El lienzo de diseño lleva todo su estado —un `.dc.html` por tablero, más
`canvas.json`— dentro de un `<script type="application/json" id="appifact-doc">` en la página. Y cada
tablero lleva dentro un `<script src="./support.js"></script>`.

`JSON.stringify` **no escapa la barra**. El original guardaba `<\/script>`; al reconstruir la página
con `JSON.stringify(doc)` salen `</script>` literales, el navegador cierra el bloque en el **primero**
y el editor recibe un documento cortado. Costó una publicación: el bloque terminaba en el carácter
**229** de 630.363.

- Escapa a mano al incrustar: `JSON.stringify(o).replace(/<\/script/gi, '<\\/script')`.
- Compruébalo antes de publicar, no después: en la línea del bloque, `indexOf('</script>')` tiene que
  ser igual a `lastIndexOf('</script>')`.
- Parsea el bloque tal y como lo va a leer el navegador y cuenta los tableros. Un `JSON.parse` sobre
  lo que escribiste no prueba nada; el corte lo hace el HTML, no el JSON.
- La página no da ningún error visible. Se ve vacía, que es exactamente lo que un lienzo grande
  parece cuando de verdad es grande. El usuario lo diagnosticó como tamaño; era esto.

## El puerto de otro carril responde por el tuyo, y los rojos no tienen patrón

Medido 2026-09-09. La fórmula está en `AGENTS.md`: un carril sirve la app de lectura en
`:310<n-1>`. El carril 4 es **:3103**; **:3102 es el carril 3**.

El orquestador mandó a un agente del carril 4 correr su suite contra `:3102`. Su propio servidor
murió a mitad de una corrida por presión de memoria, y **las peticiones siguientes las respondió el
servidor del carril 3**, que servía otra rama. Resultado: tres corridas con fallos extendidos y sin
patrón que no eran ningún defecto.

- Cuenta el puerto desde el número de carril antes de escribirlo en un despacho. `310<n-1>`.
- Un rojo que cambia de sitio entre corridas y no tiene patrón es un servidor equivocado, no un
  defecto. Comprueba **de quién es el proceso** antes de perseguirlo:
  `readlink /proc/<pid>/cwd` dice desde qué carril arrancó.
- Con tres servidores y tres Chromium en nueve GB, un servidor **muere a mitad de una corrida** sin
  decir nada. La suite no se entera: sigue recibiendo respuestas.
- Mata sólo tus propios procesos, identificados uno a uno. Nunca un `pkill -f` sobre una ruta: el
  patrón alcanza tu propia shell y los carriles de al lado.

## `.next/dev/types` viejo pone en rojo un typecheck que está bien

Medido 2026-09-09, carril 5, al fusionar las cinco ramas del slice de lectura.

`npm run typecheck` dio dos errores sobre la ruta nueva `/registro/[palabra]`:

```
app/registro/[palabra]/page.tsx(8,69): error TS2344: Type '"/registro/[palabra]"' does not satisfy the constraint 'AppRoutes'.
app/registro/[palabra]/page.tsx(9,11): error TS2339: Property 'palabra' does not exist on type 'unknown'.
```

**Un `next build` completo no lo arregló.** El build sí escribe `.next/types/routes.d.ts` con la
ruta dentro, pero el `tsconfig.json` de la app incluye **dos** directorios generados:

```
".next/types/**/*.ts",
".next/dev/types/**/*.ts"
```

El segundo lo escribe `next dev`, no `next build`, y en un carril que corrió `next dev` sobre un
árbol anterior se queda **congelado con la lista de rutas de aquel día**. Las dos declaraciones de
`AppRoutes` conviven y gana la vieja.

- `rm -rf apps/<app>/.next/dev/types` y vuelve a correr. Segundos, y el rojo desaparece.
- Sospéchalo cuando el rojo es **sólo** de rutas o de `PageProps`/`LayoutProps` y el fichero
  generado sí tiene la ruta: `grep AppRoutes .next/types/routes.d.ts` contra
  `.next/dev/types/routes.d.ts`. Si difieren, es esto.
- Un `apps/<app>/.next` que no existe da la misma familia de rojo por otra causa —
  `Cannot find name 'PageProps'` en cada página—, y ése sí lo arregla un `next build`. Un carril
  recién nacido no tiene `.next` de ninguna app que no haya construido.
- Ninguno de los dos es un rojo real. CI construye antes de comprobar y nunca los ve.

## Una rama apilada no lleva la punta de la rama de la que salió

Medido 2026-09-09. Cuatro ramas apiladas: 2 → 5 → 6 → 10. Fusionar la 10 parecía traer las cuatro,
y trae **tres y media**: la 10 se cortó de `f97decf`, el penúltimo commit de la 6, no de su punta
`ac8aba3`. Ese commit era el que metía `sin-entrada.spec.ts` en el proyecto `desktop` de Playwright.
La fusión pasó limpia, la suite pasó verde, y **cuatro pruebas de escritorio simplemente no
existían**.

- Comprueba la punta, no la rama: `git merge-base --is-ancestor <rama> <la-de-arriba>` por cada
  eslabón, antes de decidir que fusionar la última basta.
- `git log <integracion>..<rama-de-arriba> --oneline` y cuenta: si falta un commit que sabes que
  existe, la pila se cortó por en medio.
- Una punta que llega **después** de que se cortara la rama de encima es lo normal, no lo raro. Un
  arreglo pedido al trabajador cuando su rama ya había parido la siguiente cae siempre aquí.
- Fusiona la rama de en medio también. Es un merge vacío si ya estaba, y no cuesta nada.

## Un carril cortado de un `integracion` local sin empujar acusa al trabajador de salirse del encargo

Medido 2026-09-09. El carril 4 volvió con **FAIL por alcance de ficheros**: su rama traía un segundo
commit, `8a418ac`, que tocaba dos ficheros fuera de la lista permitida.

El commit era **mío**. Lo había comiteado en `integracion` local y no lo había empujado; `worktree.sh`
corta de la rama local, así que los carriles nacidos después lo heredaron. Cuando otro PR lo subió
dentro de su squash, `integracion` quedó con el **contenido** pero sin el **commit**, y a partir de
ahí `git log integracion..<rama>` lo lista como si fuera de la rama.

- Compara **árboles, no historia**, antes de acusar a nadie de salirse del encargo:
  `git diff --stat origin/<base>..origin/<rama> -- <los ficheros sospechosos>`. Vacío significa que
  ya están idénticos arriba, sea cual sea la historia.
- Mira qué toca **el commit del trabajador**, no la rama: `git show --stat <sha>`.
- El diff de tres puntos (`base...rama`) sale del ancestro común y **enseña lo que ya subió por otra
  vía**. El de dos puntos (`base..rama`) compara los dos árboles. Para juzgar alcance, dos puntos.
- Empuja `integracion` antes de abrir un carril. Cuesta un segundo y ahorra esto.
- Dos validadores vieron la misma rama el mismo día. Uno cayó en la trampa y falló al trabajador;
  el otro la nombró, comprobó los árboles y pasó. La diferencia estuvo en comprobar, no en saber.

## Un servidor de producción viejo hace que un crítico juzgue código que no está corriendo

Medido 2026-09-09. Arreglé un desbordamiento de 240 px, comiteé, y dejé corriendo el `next start`
que ya estaba levantado. El crítico llegó después, **midió el build viejo** (1520 px contra 1280),
**leyó el fuente ya arreglado**, y concluyó que el arreglo no funcionaba — con un mecanismo inventado
para explicar por qué.

- `next start` sirve el `.next` que había al arrancar. Un `git commit` no lo cambia.
- Reconstruye y reinicia **antes** de mandar a alguien a conducir la app. `rm -rf .next/dev/types`,
  `npm run build`, `fuser -k <puerto>/tcp`, `npx next start`.
- Cuando un agente diga que un arreglo no funciona, **mide tú sobre un build fresco** antes de
  creerle. Un mecanismo bien argumentado sobre una medición vieja sigue siendo falso.
- El mecanismo que inventó era plausible y estaba mal: `width: auto` en un hijo de una columna flex
  **sí** resta los márgenes al estirarse. Eso es lo que arregla el desbordamiento.

## This machine cannot test a reserved scrollbar

Measured 2026-09-09 while fixing `components/ui/page.module.css`'s `100vw` centring. Chromium here
uses overlay scrollbars: `window.innerWidth - document.documentElement.clientWidth` is **0** in every
configuration tried, including a forced `html { height: 3000px }` at 1280×400. There is no Firefox
installed. So a bug whose whole symptom is *the scrollbar takes width* cannot be reproduced or
regression-tested in this repo at all.

The `100vw` → `100%` fix landed on reasoning, not on a red turned green: a percentage margin resolves
against the containing block's used width, already scrollbar-adjusted, while `vw` uses the raw initial
containing block. What *was* measured is that the fix breaks nothing — reading-column gaps symmetric
at 1280/1920/2560 (210/210, 530/530, 850/850), zero overflow on all three `measure="full"` routes at
all three widths, `escritorio.spec.ts` 5/5.

Say so when you touch a viewport-unit rule here. A green suite is not evidence about scrollbars on
this machine; it is silence.

## tsgo caches a red past the edit that fixed it

Measured 2026-09-09 while proving a message key was live. Deleting a key made `npm run typecheck`
fall red; restoring the file byte-for-byte (`md5sum` identical, `git status` clean) left it red.
`tsconfig.tsbuildinfo` and `.next/cache/.tsbuildinfo` had cached the diagnostics. Delete both to get
a true re-read.

This sits beside the `.next/dev/types` trap and behaves worse: that one gives a red a full build
clears, this one survives the edit that fixed it. When a typecheck disagrees with a file you just
restored, suspect the cache before the code.

## `gh pr merge` authors the squash as the GitHub account, not as wilson

Measured 2026-09-09 at the close of a 16-PR session: of 73 commits on `integracion`, **41 were
`wilson <cxrkeybwp2004@gmail.com>` and 32 were `Cxrkeyb <88465069+Cxrkeyb@users.noreply.github.com>`**
— every one of the 32 a squash commit GitHub minted when `gh pr merge --squash` ran. `git config
user.email` was correct the whole time; it never applies, because the squash is made server-side
under the authenticated account.

`AGENTS.md` says to commit as wilson. That rule holds for every commit written locally and breaks on
every merge, silently, in any session that lands PRs. Nothing catches it: the trailer check passes
(there is no Claude trailer), and `git log --format='%an'` is only read on the branch, before the
merge.

**Settled 2026-09-09 by the user: it is acceptable.** Keep using `gh pr merge --squash`. The squash
commit carries the GitHub account; the branch's own commits stay wilson's, and those are the ones
`AGENTS.md` means. Do not raise this again, and do not merge by hand to work around it.
