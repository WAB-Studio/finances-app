import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

// The append-only trail of every write (RF-43/44/45): one row per INSERT, UPDATE or DELETE, stamped
// with the full before/after snapshot. The capture trigger is the only writer and the RNF-14 purge the
// only deleter — both land in the migration. No foreign keys: the log outlives the rows it references,
// so a purged or deleted record still reads back. `owner_user_id`/`group_id` scope the row the way its
// entity was scoped, both null for child or reference rows; `actor_user_id` null marks a system write.
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    entity: text().notNull(),
    recordId: text().notNull(),
    action: text({ enum: ["INSERT", "UPDATE", "DELETE"] }).notNull(),
    // Nullable, no reference: null is a system write, and the actor may be gone by read time.
    actorUserId: uuid(),
    // Scope mirrors the audited row, populated opportunistically by the trigger; both null when unscoped.
    ownerUserId: uuid(),
    groupId: uuid(),
    beforeData: jsonb(),
    afterData: jsonb(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("audit_log_action_valid", sql`${table.action} in ('INSERT', 'UPDATE', 'DELETE')`),
    index("audit_log_entity_record_id_idx").on(table.entity, table.recordId),
    index("audit_log_occurred_at_idx").on(table.occurredAt),
    index("audit_log_owner_user_id_idx")
      .on(table.ownerUserId)
      .where(sql`${table.ownerUserId} is not null`),
    index("audit_log_group_id_idx")
      .on(table.groupId)
      .where(sql`${table.groupId} is not null`),
    // Read-only viewer (RF-53): a user reads a row scoped to them personally, scoped to a group they
    // belong to, or one they themselves caused — the last surfaces the unscoped child rows to their
    // actor alone. No write policy accompanies it: the log stays append-only to the trigger (RF-44).
    pgPolicy("audit_log_select_scope", {
      for: "select",
      to: authenticatedRole,
      using: sql`(${table.ownerUserId} = ${authUid} or (${table.groupId} is not null and (select private.is_group_member(${table.groupId}))) or ${table.actorUserId} = ${authUid})`,
    }),
  ],
).enableRLS();

export type AuditLog = typeof auditLog.$inferSelect;
