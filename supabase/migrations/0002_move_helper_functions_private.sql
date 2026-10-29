-- Keep helper functions out of the public API (Supabase security advisor recommendation)
create schema if not exists private;
grant usage on schema private to anon, authenticated;

alter function public.is_admin() set schema private;
alter function public.guard_public_inquiry() set schema private;
alter function public.touch_updated_at() set schema private;

revoke all on function private.guard_public_inquiry() from public, anon, authenticated;
revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.is_admin() from public, anon;
grant execute on function private.is_admin() to authenticated;

create or replace function private.guard_public_inquiry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if (select auth.role()) = 'authenticated' and private.is_admin() then
        return new;
    end if;
    new.status := 'new';
    new.follow_up_on := null;
    new.quote_amount := null;
    new.deposit_amount := null;
    new.deposit_received_on := null;
    new.closed_reason := null;
    new.created_at := now();
    if (select count(*) from public.inquiries
        where lower(email) = lower(new.email) and created_at > now() - interval '1 hour') >= 3 then
        raise exception 'Too many requests from this email. Please try again later.';
    end if;
    if (select count(*) from public.inquiries where created_at > now() - interval '1 hour') >= 40 then
        raise exception 'We are receiving a high volume of requests. Please try again shortly.';
    end if;
    return new;
end;
$$;
revoke all on function private.guard_public_inquiry() from public, anon, authenticated;
