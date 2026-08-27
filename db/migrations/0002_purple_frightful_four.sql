-- Allows the functions below to reference members/funds before those tables exist yet in this transaction.
set local check_function_bodies = off;
--> statement-breakpoint
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
--> statement-breakpoint
create or replace function private.is_fund_member(uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.fund_id = $1 and m.user_id = (select auth.uid()) and m.archived_at is null
  );
$$;--> statement-breakpoint
revoke all on function private.is_fund_member(uuid) from public, anon, service_role;--> statement-breakpoint
grant execute on function private.is_fund_member(uuid) to authenticated;--> statement-breakpoint
create or replace function private.fund_is_unclaimed(uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.members m where m.fund_id = $1);
$$;--> statement-breakpoint
revoke all on function private.fund_is_unclaimed(uuid) from public, anon, service_role;--> statement-breakpoint
grant execute on function private.fund_is_unclaimed(uuid) to authenticated;--> statement-breakpoint
create or replace function private.assert_fund_keeps_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The fund itself is gone: the cascade took its members with it, which is legal.
  if not exists (select 1 from public.funds f where f.id = old.fund_id) then return null; end if;
  if not exists (
    select 1 from public.members m
    where m.fund_id = old.fund_id and m.role = 'owner' and m.archived_at is null
  ) then
    raise exception 'fund % would be left without an owner', old.fund_id using errcode = 'check_violation';
  end if;
  return null;
end;
$$;
revoke all on function private.assert_fund_keeps_owner() from public, anon, authenticated, service_role;--> statement-breakpoint
create or replace function private.set_row_timestamps() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := pg_catalog.now();
  else
    -- Once a later slice grants UPDATE, a caller still cannot rewrite when the row was born.
    new.created_at := old.created_at;
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function private.set_row_timestamps() from public, anon, authenticated, service_role;
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'COP' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "funds_name_length" CHECK (length(btrim("funds"."name")) between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "funds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "funds" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "funds" FROM public, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "funds" TO authenticated;--> statement-breakpoint
CREATE TRIGGER funds_set_timestamps BEFORE INSERT OR UPDATE ON "funds"
  FOR EACH ROW EXECUTE FUNCTION private.set_row_timestamps();--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_id_fund_id_unique" UNIQUE("id","fund_id"),
	CONSTRAINT "members_name_length" CHECK (length(btrim("members"."name")) between 1 and 80),
	CONSTRAINT "members_role_valid" CHECK ("members"."role" in ('owner', 'member')),
	CONSTRAINT "members_owner_has_user" CHECK ("members"."role" <> 'owner' or "members"."user_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "members" FROM public, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "members" TO authenticated;--> statement-breakpoint
CREATE TRIGGER members_set_timestamps BEFORE INSERT OR UPDATE ON "members"
  FOR EACH ROW EXECUTE FUNCTION private.set_row_timestamps();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER members_keep_owner
  AFTER UPDATE OR DELETE ON "members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.role = 'owner' AND OLD.archived_at IS NULL)
  EXECUTE FUNCTION private.assert_fund_keeps_owner();--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"member_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"institution" text,
	"initial_balance_cents" bigint DEFAULT 0 NOT NULL,
	"initial_balance_on" date NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_name_length" CHECK (length(btrim("accounts"."name")) between 1 and 80),
	CONSTRAINT "accounts_kind_valid" CHECK ("accounts"."kind" in ('asset', 'liability'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "accounts" FROM public, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "accounts" TO authenticated;--> statement-breakpoint
CREATE TRIGGER accounts_set_timestamps BEFORE INSERT OR UPDATE ON "accounts"
  FOR EACH ROW EXECUTE FUNCTION private.set_row_timestamps();--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fund_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_id_fund_id_unique" UNIQUE("id","fund_id"),
	CONSTRAINT "categories_name_length" CHECK (length(btrim("categories"."name")) between 1 and 80),
	CONSTRAINT "categories_kind_valid" CHECK ("categories"."kind" in ('expense', 'income'))
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "categories" FROM public, anon, authenticated, service_role;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "categories" TO authenticated;--> statement-breakpoint
CREATE TRIGGER categories_set_timestamps BEFORE INSERT OR UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION private.set_row_timestamps();--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_member_id_fund_id_members_id_fund_id_fk" FOREIGN KEY ("member_id","fund_id") REFERENCES "public"."members"("id","fund_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_fund_id_funds_id_fk" FOREIGN KEY ("fund_id") REFERENCES "public"."funds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fund_id_categories_id_fund_id_fk" FOREIGN KEY ("parent_id","fund_id") REFERENCES "public"."categories"("id","fund_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_fund_user_unique" ON "members" USING btree ("fund_id","user_id") WHERE "members"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "members_fund_id_idx" ON "members" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "members_user_id_fund_id_idx" ON "members" USING btree ("user_id","fund_id");--> statement-breakpoint
CREATE INDEX "accounts_fund_id_idx" ON "accounts" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "accounts_member_id_idx" ON "accounts" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "categories_fund_id_idx" ON "categories" USING btree ("fund_id");--> statement-breakpoint
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");--> statement-breakpoint
CREATE POLICY "funds_select_member" ON "funds" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select private.is_fund_member("funds"."id")));--> statement-breakpoint
CREATE POLICY "funds_insert_any" ON "funds" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "members_select_member" ON "members" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select private.is_fund_member("members"."fund_id")));--> statement-breakpoint
CREATE POLICY "members_insert_owner_claim" ON "members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "members"."user_id" and "members"."role" = 'owner' and (select private.fund_is_unclaimed("members"."fund_id")));--> statement-breakpoint
CREATE POLICY "accounts_select_member" ON "accounts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select private.is_fund_member("accounts"."fund_id")));--> statement-breakpoint
CREATE POLICY "accounts_insert_member" ON "accounts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select private.is_fund_member("accounts"."fund_id")));--> statement-breakpoint
CREATE POLICY "categories_select_member" ON "categories" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select private.is_fund_member("categories"."fund_id")));--> statement-breakpoint
CREATE POLICY "categories_insert_member" ON "categories" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select private.is_fund_member("categories"."fund_id")));