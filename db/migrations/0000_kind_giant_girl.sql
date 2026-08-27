CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'es' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "app_users" ADD CONSTRAINT "app_users_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "app_users_select_self" ON "app_users" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "app_users"."id");--> statement-breakpoint
CREATE POLICY "app_users_insert_self" ON "app_users" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "app_users"."id");--> statement-breakpoint
CREATE POLICY "app_users_update_self" ON "app_users" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "app_users"."id") WITH CHECK ((select auth.uid()) = "app_users"."id");--> statement-breakpoint
ALTER TABLE "app_users" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "app_users" FROM public, anon, service_role;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "app_users" TO authenticated;