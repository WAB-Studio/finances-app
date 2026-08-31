-- Widening the projection by `id` put an OUT variable named `id` in scope, so the bare `id` in each
-- update's predicate stopped naming the column and every resolution raised 42702. The table is aliased
-- and the predicate qualified in all three branches; the returned column keeps its name. The throttle,
-- the row lock and the revoked-token behaviour are those of the original.
create or replace function private.resolve_webhook_credential(p_token_hash text)
returns table(id uuid, owner_user_id uuid, default_account_id uuid, default_category_id uuid, throttled boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_cred public.webhook_credentials;
  v_reset boolean;
  v_throttled boolean;
begin
  select * into v_cred from public.webhook_credentials c
    where c.token_hash = p_token_hash and c.revoked_at is null
    for update;
  if not found then return; end if;
  v_reset := v_cred.rate_window_started_at is null
             or (pg_catalog.now() - v_cred.rate_window_started_at) >= interval '1 minute';
  if v_reset then
    v_throttled := false;
    update public.webhook_credentials c set last_used_at = pg_catalog.now(),
      rate_window_started_at = pg_catalog.now(), rate_count = 1 where c.id = v_cred.id;
  elsif v_cred.rate_count < v_cred.rate_limit_per_min then
    -- The request that reaches exactly the limit is still admitted.
    v_throttled := false;
    update public.webhook_credentials c set last_used_at = pg_catalog.now(),
      rate_count = v_cred.rate_count + 1 where c.id = v_cred.id;
  else
    -- Over the limit: a valid token, but do not count it and do not admit it.
    v_throttled := true;
    update public.webhook_credentials c set last_used_at = pg_catalog.now() where c.id = v_cred.id;
  end if;
  return query select v_cred.id, v_cred.owner_user_id, v_cred.default_account_id,
    v_cred.default_category_id, v_throttled;
end;
$$;--> statement-breakpoint
revoke all on function private.resolve_webhook_credential(text) from public, anon, authenticated, service_role;
