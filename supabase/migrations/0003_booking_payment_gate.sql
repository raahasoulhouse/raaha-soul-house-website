-- A booking can only be Confirmed (or Completed) when either:
--   a) the deposit is recorded as received: amount > 0, date received, and a payment reference
--      (e.g. the Square invoice or receipt number), or
--   b) an authorized exception is recorded with a written reason.
-- Enforced in the database, so it holds no matter which screen or tool makes the change.

alter table public.inquiries
    add column payment_reference text check (char_length(payment_reference) <= 120),
    add column confirmation_exception text check (char_length(confirmation_exception) <= 500),
    add column confirmed_at timestamptz,
    add column confirmed_by uuid;

create or replace function private.enforce_booking_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if new.status in ('confirmed', 'completed') and (tg_op = 'INSERT' or old.status is distinct from new.status or
       old.deposit_received_on is distinct from new.deposit_received_on or
       old.payment_reference is distinct from new.payment_reference or
       old.confirmation_exception is distinct from new.confirmation_exception or
       old.deposit_amount is distinct from new.deposit_amount) then
        if not (
            (coalesce(new.deposit_amount, 0) > 0
             and new.deposit_received_on is not null
             and nullif(trim(coalesce(new.payment_reference, '')), '') is not null)
            or nullif(trim(coalesce(new.confirmation_exception, '')), '') is not null
        ) then
            raise exception 'A booking can be confirmed only after the deposit is received (amount, date and payment reference) or with a written exception.';
        end if;
        if new.confirmed_at is null then
            new.confirmed_at := now();
            new.confirmed_by := auth.uid();
        end if;
    end if;
    if new.status not in ('confirmed', 'completed') then
        new.confirmed_at := null;
        new.confirmed_by := null;
    end if;
    return new;
end;
$$;
revoke all on function private.enforce_booking_payment() from public, anon, authenticated;

create trigger inquiries_payment_gate before insert or update on public.inquiries
for each row execute function private.enforce_booking_payment();

-- public visitors still cannot write any of the new fields (column grants unchanged for anon)

-- non-admin submissions can never set the new booking fields either
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
revoke all on function private.guard_public_inquiry() from public, anon, authenticated;
