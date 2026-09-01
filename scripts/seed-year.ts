/**
 * The year of movements RNF-09 is measured against, and its removal. 4 015
 * movements — eleven a day for 365 days — written for a named user THROUGH the
 * app's own insert path, so the ledger under measurement is the one the app
 * would have written rather than SQL invented here.
 *
 * Repeatable: every movement carries an `external_ref` derived from its index,
 * so a second run tops the ledger up to 4 015 instead of doubling it, and an
 * interrupted run resumes. `drop` deletes exactly what those references name,
 * plus the accounts and categories the seed made, which returns every table to
 * the count it found — `audit_log` excepted, whose rows no path here removes.
 *
 * Usage:
 *   npm run seed:year          # top the named user's ledger up to 4 015
 *   npm run seed:year:drop     # remove them and the scaffolding
 *   npm run seed:year -- count # census only, writing nothing
 *
 * The user defaults to the HTTP harness's own identity, which is the identity
 * `check:http` measures the dashboard under. `--email=` names another.
 */
import { createAccount } from "@/db/queries/accounts";
import { createCategory } from "@/db/queries/categories";
import { insertTransaction } from "@/db/queries/transactions";
import type { CreateTransactionArgs } from "@/db/queries/transactions";
import { withUserDb } from "@/db/session";
import { addCivilDays, todayInBogota } from "@/lib/dates";

import {
  findUserByEmail,
  fixtureSql,
  YEAR_OF_MOVEMENTS,
  YEAR_SEED_PREFIX,
} from "./harness/fixtures";
import type { HarnessUser } from "./harness/fixtures";
import { HARNESS_EMAIL } from "./harness/session";

// Named after the requirement so a row left behind by a killed run says what it
// belongs to. Accounts and categories are found again by these names, which is
// what makes a second run reuse the scaffolding instead of duplicating it.
const SCAFFOLD_PREFIX = "RNF-09";

/**
 * The tables the seed can possibly write, and how a row of each is attributed to
 * the seeded user. The census is per user, not global: this database is shared
 * with the other harness layers, and a global count moves under a run that has
 * nothing to do with the seed — which would make "every table back at the count
 * it found" unprovable rather than false. A split and a label carry no owner, so
 * they are attributed through the movement they hang off.
 *
 * `audit_log` is counted and reported, never expected back: the trail is
 * append-only and only the RNF-14 purge removes from it.
 */
const CENSUS_TABLES = {
  accounts: "select count(*) from accounts where owner_user_id = $1",
  categories: "select count(*) from categories where owner_user_id = $1",
  transactions: "select count(*) from transactions where owner_user_id = $1",
  transaction_splits:
    "select count(*) from transaction_splits s join transactions t on t.id = s.transaction_id where t.owner_user_id = $1",
  transaction_labels:
    "select count(*) from transaction_labels tl join transactions t on t.id = tl.transaction_id where t.owner_user_id = $1",
  audit_log: "select count(*) from audit_log where owner_user_id = $1",
} as const;

type CensusTable = keyof typeof CENSUS_TABLES;

// Movements per commit, and commits in flight at once. The driver does NOT
// pipeline inside a transaction — it sends the next statement only once the
// previous one answered — so a movement costs its two round trips whatever the
// batch size. Concurrency is what buys the throughput back: `PARALLEL` matches
// `db/client.ts`'s `max`, so every connection in the pool is writing.
const BATCH = 32;
const PARALLEL = 8;

type Census = Record<string, number>;

type Scaffold = {
  bankAccountId: string;
  cashAccountId: string;
  cardAccountId: string;
  expenseCategoryIds: string[];
  incomeCategoryId: string;
};

const EXPENSE_CATEGORIES = [
  "Mercado",
  "Transporte",
  "Restaurantes",
  "Servicios",
  "Salud",
  "Ocio",
];

function argument(name: string): string | undefined {
  const found = process.argv.find((one) => one.startsWith(`--${name}=`));

  return found?.slice(name.length + 3);
}

// A deterministic stream, so two runs write the same ledger: a re-run that tops
// up the missing movements writes what the first run would have written.
function noise(index: number, salt: number): number {
  const mixed = Math.imul(index + 1, 2654435761) ^ Math.imul(salt + 1, 40503);

  return Math.abs(mixed % 100000);
}

/**
 * The movement at `index`, as the quick-entry form would have submitted it.
 * Eleven a day: nine expenses, one income, and a transfer to cash once a week
 * where an expense would otherwise be. Every fifth expense splits in two, so the
 * split path is exercised at the shape the screens read it back at.
 */
function movementAt(index: number, day: string, scaffold: Scaffold): CreateTransactionArgs {
  const slot = index % 11;
  const dayIndex = Math.floor(index / 11);
  const externalRef = `${YEAR_SEED_PREFIX}${index}`;

  if (slot === 10) {
    const amountCents = 180000000 + noise(index, 1) * 100;

    return {
      fromAccountId: null,
      toAccountId: scaffold.bankAccountId,
      amountCents,
      occurredAt: day,
      description: "Ingreso del día",
      externalRef,
      splits: [{ categoryId: scaffold.incomeCategoryId, amountCents }],
      labelIds: [],
    };
  }

  if (slot === 9 && dayIndex % 7 === 0) {
    return {
      fromAccountId: scaffold.bankAccountId,
      toAccountId: scaffold.cashAccountId,
      amountCents: 10000000 + noise(index, 2) * 100,
      occurredAt: day,
      // A transfer carries no split and no category (RF-19).
      description: "Retiro de efectivo",
      externalRef,
      splits: [],
      labelIds: [],
    };
  }

  const amountCents = 300000 + noise(index, 3) * 250;
  const categoryId = scaffold.expenseCategoryIds[slot % scaffold.expenseCategoryIds.length];
  // Alternating source, so neither account carries the whole year and the
  // balance view has both an asset and a liability to derive.
  const fromAccountId = slot % 3 === 0 ? scaffold.cardAccountId : scaffold.bankAccountId;

  const splits =
    index % 5 === 0
      ? [
          { categoryId, amountCents: Math.floor(amountCents / 3) },
          {
            categoryId:
              scaffold.expenseCategoryIds[(slot + 1) % scaffold.expenseCategoryIds.length],
            amountCents: amountCents - Math.floor(amountCents / 3),
          },
        ]
      : [{ categoryId, amountCents }];

  return {
    fromAccountId,
    toAccountId: null,
    amountCents,
    occurredAt: day,
    description: `Gasto ${slot + 1} del ${day}`,
    externalRef,
    splits,
    labelIds: [],
  };
}

// One round trip for the whole census: every count unioned, each subquery reading
// the same user id. Built with `unsafe` because a count is a whole statement, not
// a value; every fragment comes from the constant above and none from an argument.
async function census(userId: string): Promise<Census> {
  const rows = await fixtureSql.unsafe<{ name: string; total: string }[]>(
    tables()
      .map((table) => `select '${table}' as name, (${CENSUS_TABLES[table]})::text as total`)
      .join(" union all "),
    [userId],
  );

  return Object.fromEntries(rows.map((row) => [row.name, Number(row.total)]));
}

function tables(): CensusTable[] {
  return Object.keys(CENSUS_TABLES) as CensusTable[];
}

function printCensus(when: string, counts: Census): void {
  const line = tables()
    .map((table) => `${table} ${counts[table]}`)
    .join(", ");

  console.log(`CENSUS  ${when}: ${line}`);
}

// The difference the run left, table by table. A drop that reports nothing but
// `audit_log` is a drop that took back exactly what the seed wrote.
function printDelta(before: Census, after: Census): void {
  const moved = tables()
    .filter((table) => after[table] !== before[table])
    .map(
      (table) =>
        `${table} ${after[table] - before[table] > 0 ? "+" : ""}${after[table] - before[table]}`,
    );

  console.log(
    `CENSUS  delta: ${moved.length === 0 ? "every table unchanged" : moved.join(", ")}`,
  );
}

async function resolveUser(email: string): Promise<HarnessUser> {
  const user = await findUserByEmail(email);

  if (!user) {
    throw new Error(
      `no auth user for ${email} — run \`npm run check:http\` once, which creates the harness identity, or pass --email=`,
    );
  }

  return user;
}

/**
 * The three accounts and seven categories the year is filed against, created on
 * the first run and found again on every later one. Created through
 * `createAccount` and `createCategory`, so the rows carry what the screens write.
 */
async function ensureScaffold(userId: string): Promise<Scaffold> {
  // Both sides in one round trip, keyed by name: an account and a category of
  // this seed never share one, so the two sets can be looked up together.
  const existing = await fixtureSql<{ id: string; name: string }[]>`
    select id, name from accounts
      where owner_user_id = ${userId} and name like ${`${SCAFFOLD_PREFIX}%`}
    union all
    select id, name from categories
      where owner_user_id = ${userId} and name like ${`${SCAFFOLD_PREFIX}%`}`;

  const found = new Map(existing.map((row) => [row.name, row.id]));
  const today = todayInBogota();

  const account = async (
    name: string,
    kind: "asset" | "liability",
    subtype: "bancaria" | "efectivo" | "tarjeta",
    pesos: number,
  ): Promise<string> => {
    const fullName = `${SCAFFOLD_PREFIX} ${name}`;
    const already = found.get(fullName);
    if (already) return already;

    const { accountId } = await createAccount({
      name: fullName,
      kind,
      subtype,
      ownerUserId: userId,
      groupId: null,
      isShared: false,
      institution: "Bancolombia",
      lastFour: null,
      pesos,
      // A year back, so the opening balance predates the oldest movement.
      balanceOn: addCivilDays(today, -366),
    });

    return accountId;
  };

  const category = async (name: string, kind: "expense" | "income"): Promise<string> => {
    const fullName = `${SCAFFOLD_PREFIX} ${name}`;
    const already = found.get(fullName);
    if (already) return already;

    const { categoryId } = await createCategory({
      scope: { ownerUserId: userId },
      name: fullName,
      kind,
      parentId: null,
      color: "#4C8C4A",
    });

    return categoryId;
  };

  const expenseCategoryIds: string[] = [];
  for (const name of EXPENSE_CATEGORIES) {
    expenseCategoryIds.push(await category(name, "expense"));
  }

  return {
    bankAccountId: await account("banco", "asset", "bancaria", 12000000),
    cashAccountId: await account("efectivo", "asset", "efectivo", 200000),
    cardAccountId: await account("tarjeta", "liability", "tarjeta", 3000000),
    expenseCategoryIds,
    incomeCategoryId: await category("Salario", "income"),
  };
}

async function seededIndexes(userId: string): Promise<Set<number>> {
  const rows = await fixtureSql<{ external_ref: string }[]>`
    select external_ref from transactions
    where owner_user_id = ${userId} and external_ref like ${`${YEAR_SEED_PREFIX}%`}`;

  return new Set(rows.map((row) => Number(row.external_ref.slice(YEAR_SEED_PREFIX.length))));
}

async function seed(user: HarnessUser): Promise<void> {
  const scaffold = await ensureScaffold(user.id);
  const already = await seededIndexes(user.id);
  const missing: number[] = [];
  for (let index = 0; index < YEAR_OF_MOVEMENTS; index += 1) {
    if (!already.has(index)) missing.push(index);
  }

  console.log(
    `SEED    ${already.size} of ${YEAR_OF_MOVEMENTS} movements are already in place; writing ${missing.length}.`,
  );
  if (missing.length === 0) return;

  const today = todayInBogota();
  const started = Date.now();

  const writeBatch = (batch: number[]) =>
    withUserDb(async (tx) => {
      for (const index of batch) {
        await insertTransaction(
          tx,
          movementAt(index, addCivilDays(today, Math.floor(index / 11) - 364), scaffold),
        );
      }
    });

  let written = 0;
  const stride = BATCH * PARALLEL;

  for (let at = 0; at < missing.length; at += stride) {
    const wave = missing.slice(at, at + stride);
    const batches: number[][] = [];
    for (let cut = 0; cut < wave.length; cut += BATCH) {
      batches.push(wave.slice(cut, cut + BATCH));
    }

    const waveStarted = Date.now();
    await Promise.all(batches.map(writeBatch));
    written += wave.length;

    console.log(
      `SEED    ${written} of ${missing.length} written, last ${batches.length} commits in ${Date.now() - waveStarted} ms.`,
    );
  }

  console.log(`SEED    ${missing.length} movements written in ${Date.now() - started} ms.`);
}

/**
 * Removes exactly what the seed wrote: the movements its references name — their
 * splits cascade — then the scaffolding, which no other row points at once the
 * movements are gone.
 */
async function drop(user: HarnessUser): Promise<void> {
  const movements = await fixtureSql`
    delete from transactions
    where owner_user_id = ${user.id} and external_ref like ${`${YEAR_SEED_PREFIX}%`}`;

  const categories = await fixtureSql`
    delete from categories
    where owner_user_id = ${user.id} and name like ${`${SCAFFOLD_PREFIX}%`}`;

  const accounts = await fixtureSql`
    delete from accounts
    where owner_user_id = ${user.id} and name like ${`${SCAFFOLD_PREFIX}%`}`;

  console.log(
    `DROP    ${movements.count} movements, ${categories.count} categories and ${accounts.count} accounts removed.`,
  );
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "seed";
  if (!["seed", "drop", "count"].includes(command)) {
    throw new Error(`unknown command "${command}" — use seed, drop or count`);
  }

  const user = await resolveUser(argument("email") ?? HARNESS_EMAIL);
  // Read by the Supabase stub, so every app function below speaks for this user
  // and meets RLS as they would in a request.
  process.env.HARNESS_USER_ID = user.id;
  process.env.HARNESS_USER_EMAIL = user.email;
  console.log(`SEED    ${command} for ${user.email} (${user.id}).`);

  const before = await census(user.id);
  printCensus("before", before);

  if (command === "seed") await seed(user);
  if (command === "drop") await drop(user);

  const after = await census(user.id);
  printCensus("after", after);
  printDelta(before, after);

  const [{ total }] = await fixtureSql<{ total: string }[]>`
    select count(*)::text as total from transactions where owner_user_id = ${user.id}`;
  console.log(`SEED    ${user.email} now owns ${total} movements.`);
}

// Wrapped in an async IIFE (not top-level await) so the runner can transpile this
// to CJS and run it on any Node version, not only Node 22's native strip.
void (async () => {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await fixtureSql.end();
  }

  // The app pool holds its sockets for `idle_timeout` seconds after the last
  // query, which would keep this process alive with nothing left to do.
  process.exit(process.exitCode ?? 0);
})();
