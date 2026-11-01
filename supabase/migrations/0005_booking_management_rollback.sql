-- Rollback of 0005_booking_management. Run only after downloading the Admin backup:
-- it removes all quotes, calendar blocks and the 7 new booking fields. Existing booking records, notes and content are untouched.
begin;
drop function if exists public.accept_quote(uuid);
drop table if exists public.booking_quotes;
drop table if exists public.calendar_blocks;
drop function if exists private.compute_quote_totals();
alter table public.inquiries
  drop column if exists event_start_time,
  drop column if exists event_end_time,
  drop column if exists deposit_due_on,
  drop column if exists balance_amount,
  drop column if exists balance_due_on,
  drop column if exists balance_received_on,
  drop column if exists balance_reference;
-- restore the guard exactly as it was before 0005
create or replace function private.guard_public_inquiry() returns trigger
language plpgsql security definer set search_path = '' as $$
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
    new.payment_reference := null;
    new.confirmation_exception := null;
    new.confirmed_at := null;
    new.confirmed_by := null;
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
commit;
