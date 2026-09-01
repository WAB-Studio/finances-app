import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { getUserGroup } from "@/db/queries/groups";
import { listMembers } from "@/db/queries/group-members";
import type { MemberRow } from "@/db/queries/group-members";
import { auditLog } from "@/db/schema";
import type { AuditLog } from "@/db/schema";
import { requireUser, withUserDb } from "@/db/session";
import { TIME_ZONE } from "@/lib/locales";

// The range bounds arrive as civil dates and compare against the row's Bogotá
// calendar day, so a full day is included at either end (RNF-06). A `null` actor
// filters the system writes; `undefined` drops the predicate entirely.
export type AuditLogFilters = {
  entity?: string;
  actorUserId?: string | null;
  from?: Date | string;
  to?: Date | string;
  limit: number;
  offset: number;
};

// What the viewer renders, and all it is handed: the `before_data`/`after_data`
// snapshots stay in the table, where a token hash or a bank message never reaches
// a client bundle (RNF-13).
export type AuditLogRow = Pick<
  AuditLog,
  "id" | "entity" | "recordId" | "action" | "actorUserId" | "occurredAt"
>;

// The entities the caller can actually read, and the actors to name a row by.
export type AuditFilterOptions = {
  entities: string[];
  actors: { userId: string; name: string }[];
};

// A Date bound reads back as its own Bogotá day; a string is already a civil date.
function toCivilDate(value: Date | string): string {
  if (typeof value === "string") return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(value);
}

function auditConditions(filters: AuditLogFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.entity) conditions.push(eq(auditLog.entity, filters.entity));

  if (filters.actorUserId === null) {
    conditions.push(isNull(auditLog.actorUserId));
  } else if (filters.actorUserId) {
    conditions.push(eq(auditLog.actorUserId, filters.actorUserId));
  }

  // The Bogotá calendar day of the row, compared against the civil-date bounds.
  const bogotaDay = sql`(${auditLog.occurredAt} at time zone ${TIME_ZONE})::date`;
  if (filters.from) conditions.push(sql`${bogotaDay} >= ${toCivilDate(filters.from)}`);
  if (filters.to) conditions.push(sql`${bogotaDay} <= ${toCivilDate(filters.to)}`);

  return conditions;
}

/**
 * One page of the audit trail and its total, each in its own round trip so the
 * two fan out (RF-53). The SELECT policy bounds every row to the caller's own,
 * group and self-caused scope; the filters narrow that set further. Newest first,
 * `id` breaking ties within a shared timestamp.
 */
export async function listAuditLog(
  filters: AuditLogFilters,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const conditions = auditConditions(filters);
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, total] = await Promise.all([
    withUserDb((tx) =>
      tx
        .select({
          id: auditLog.id,
          entity: auditLog.entity,
          recordId: auditLog.recordId,
          action: auditLog.action,
          actorUserId: auditLog.actorUserId,
          occurredAt: auditLog.occurredAt,
        })
        .from(auditLog)
        .where(where)
        .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
        .limit(filters.limit)
        .offset(filters.offset),
    ),
    withUserDb(async (tx) => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where);

      return row.count;
    }),
  ]);

  return { rows, total };
}

// The distinct entities present among the rows the caller may read, ordered for a
// stable Select. An entity absent from the log never offers an empty filter.
async function listAuditEntities(): Promise<string[]> {
  return withUserDb(async (tx) => {
    const rows = await tx
      .selectDistinct({ entity: auditLog.entity })
      .from(auditLog)
      .orderBy(asc(auditLog.entity));

    return rows.map((row) => row.entity);
  });
}

/**
 * The filter option lists for the viewer, fanned in one pass (RF-53). Entities
 * come from the log itself; actors from the group roster — archived members
 * included, since a row outlives the member who caused it — plus the caller, who
 * reads under their own email when they name no member.
 */
export async function getAuditFilterOptions(): Promise<AuditFilterOptions> {
  const user = await requireUser();
  const group = await getUserGroup();
  const empty = Promise.resolve<MemberRow[]>([]);

  const [entities, activeMembers, archivedMembers] = await Promise.all([
    listAuditEntities(),
    group ? listMembers(group.id, { archived: false }) : empty,
    group ? listMembers(group.id, { archived: true }) : empty,
  ]);

  const names = new Map<string, string>();
  for (const member of [...activeMembers, ...archivedMembers]) {
    if (member.userId) names.set(member.userId, member.name);
  }
  if (!names.has(user.id)) names.set(user.id, user.email);

  return {
    entities,
    actors: [...names].map(([userId, name]) => ({ userId, name })),
  };
}
