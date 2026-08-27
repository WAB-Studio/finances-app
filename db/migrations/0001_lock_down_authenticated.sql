-- Supabase grants ALL on every new `public` table to `authenticated` through
-- `alter default privileges`, so 0000's revoke of public, anon and service_role
-- left DELETE standing and its grant was a no-op. Reset the role and re-grant.
REVOKE ALL ON TABLE "app_users" FROM authenticated;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE "app_users" TO authenticated;