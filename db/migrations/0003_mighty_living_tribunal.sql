ALTER TABLE "accounts" ADD CONSTRAINT "accounts_initial_balance_sign" CHECK (("accounts"."kind" = 'asset' and "accounts"."initial_balance_cents" >= 0) or ("accounts"."kind" = 'liability' and "accounts"."initial_balance_cents" <= 0));--> statement-breakpoint
CREATE POLICY "members_insert_fund_member" ON "members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select private.is_fund_member("members"."fund_id")) and "members"."user_id" is null and "members"."role" = 'member');--> statement-breakpoint
CREATE POLICY "members_update_member" ON "members" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select private.is_fund_member("members"."fund_id"))) WITH CHECK ((select private.is_fund_member("members"."fund_id")) and ("members"."user_id" is distinct from (select auth.uid()) or "members"."archived_at" is null));--> statement-breakpoint
CREATE POLICY "members_delete_member" ON "members" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select private.is_fund_member("members"."fund_id")) and "members"."user_id" is distinct from (select auth.uid()));--> statement-breakpoint
CREATE POLICY "accounts_update_member" ON "accounts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select private.is_fund_member("accounts"."fund_id"))) WITH CHECK ((select private.is_fund_member("accounts"."fund_id")));--> statement-breakpoint
CREATE POLICY "accounts_delete_member" ON "accounts" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select private.is_fund_member("accounts"."fund_id")));--> statement-breakpoint
CREATE POLICY "categories_update_member" ON "categories" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select private.is_fund_member("categories"."fund_id"))) WITH CHECK ((select private.is_fund_member("categories"."fund_id")));--> statement-breakpoint
CREATE POLICY "categories_delete_member" ON "categories" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select private.is_fund_member("categories"."fund_id")));--> statement-breakpoint
GRANT UPDATE (name, archived_at) ON TABLE "members" TO authenticated;--> statement-breakpoint
GRANT DELETE ON TABLE "members" TO authenticated;--> statement-breakpoint
GRANT UPDATE (name, member_id, institution, initial_balance_cents, initial_balance_on, archived_at) ON TABLE "accounts" TO authenticated;--> statement-breakpoint
GRANT DELETE ON TABLE "accounts" TO authenticated;--> statement-breakpoint
GRANT UPDATE (name, color, parent_id) ON TABLE "categories" TO authenticated;--> statement-breakpoint
GRANT DELETE ON TABLE "categories" TO authenticated;--> statement-breakpoint
create or replace function private.assert_category_depth() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent public.categories;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then
    raise exception 'a category cannot be its own parent' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.categories c where c.parent_id = new.id) then
    raise exception 'category % already has children and cannot become one', new.id using errcode = 'check_violation';
  end if;
  select * into parent from public.categories c where c.id = new.parent_id;
  if parent.parent_id is not null then
    raise exception 'nesting stops at one level' using errcode = 'check_violation';
  end if;
  if parent.kind <> new.kind then
    raise exception 'a subcategory must share its parent''s kind' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.assert_category_depth() from public, anon, authenticated, service_role;--> statement-breakpoint
CREATE TRIGGER categories_assert_depth BEFORE INSERT OR UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION private.assert_category_depth();