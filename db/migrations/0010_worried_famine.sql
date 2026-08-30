CREATE POLICY "audit_log_select_scope" ON "audit_log" AS PERMISSIVE FOR SELECT TO "authenticated" USING (("audit_log"."owner_user_id" = (select auth.uid()) or ("audit_log"."group_id" is not null and (select private.is_group_member("audit_log"."group_id"))) or "audit_log"."actor_user_id" = (select auth.uid())));--> statement-breakpoint
-- The 0008 `REVOKE ALL` left `authenticated` no privilege, so the policy alone would still read zero
-- rows. Grant SELECT and only SELECT: the read-only viewer (RF-53) turns on, INSERT/UPDATE/DELETE stay
-- barred for every user role, and the log remains append-only to the definer trigger (RF-44).
GRANT SELECT ON TABLE "audit_log" TO authenticated;