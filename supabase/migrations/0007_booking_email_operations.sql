-- 0007_booking_email_operations.sql — additive; no existing record is changed or deleted.
-- Email history, booking audit trail, two new booking steps, quote acceptance with a reference,
-- automatic balance recalculation, calendar-conflict enforcement, and the inquiry acknowledgment hook.
-- Rollback: 0007_booking_email_operations_rollback.sql
begin;

-- 1. Booking steps: New inquiry → Contacted → Quote sent → Quote accepted → Deposit verified → Booking confirmed → Event completed
alter table public.inquiries drop constraint inquiries_status_check;
alter table public.inquiries add constraint inquiries_status_check check (status in
  ('new', 'contacted', 'quoted', 'quote_accepted', 'deposit_verified', 'confirmed', 'completed', 'declined', 'lost'));

-- 2. How the customer accepted (date already in responded_on)
alter table public.booking_quotes
  add column accepted_reference text check (char_length(accepted_reference) <= 300);

-- 3. Email history: every email the system sends, one row per message (duplicate-proof by idempotency key)
create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid references public.inquiries(id) on delete cascade,
  quote_id uuid references public.booking_quotes(id) on delete set null,
  kind text not null check (kind in ('ack', 'reply', 'quote', 'confirmation')),
  idempotency_key text not null unique check (char_length(idempotency_key) <= 200),
  to_email text not null check (char_length(to_email) <= 200),
  subject text not null check (char_length(subject) <= 300),
  body_text text check (char_length(body_text) <= 20000),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'delivered', 'delayed', 'bounced', 'failed', 'complained')),
  provider_id text,
  error text check (char_length(error) <= 1000),
  attempts integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_event_at timestamptz
);
create index email_log_inquiry_idx on public.email_log (inquiry_id, created_at);
create index email_log_provider_idx on public.email_log (provider_id);
alter table public.email_log enable row level security;
revoke all on public.email_log from anon, authenticated;
grant select on public.email_log to authenticated;
create policy "admins read email log" on public.email_log for select to authenticated using (private.is_admin());
-- only the server (email functions) writes this table

-- 4. Booking audit trail: status, payment and key detail changes (who, when, old → new)
create table public.booking_events (
  id bigint generated always as identity primary key,
  inquiry_id uuid references public.inquiries(id) on delete cascade,
  quote_id uuid,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  actor uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index booking_events_inquiry_idx on public.booking_events (inquiry_id, created_at);
alter table public.booking_events enable row level security;
revoke all on public.booking_events from anon, authenticated;
grant select on public.booking_events to authenticated;
create policy "admins read booking events" on public.booking_events for select to authenticated using (private.is_admin());

create function private.audit_inquiry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['status', 'deposit_amount', 'deposit_received_on', 'payment_reference', 'deposit_due_on',
      'balance_amount', 'balance_due_on', 'balance_received_on', 'balance_reference', 'quote_amount', 'is_test',
      'event_date', 'event_start_time', 'event_end_time', 'confirmation_exception'] loop
    if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
      d := d || jsonb_build_object(k, jsonb_build_array(to_jsonb(old) -> k, to_jsonb(new) -> k));
    end if;
  end loop;
  if d <> '{}'::jsonb then
    insert into public.booking_events (inquiry_id, kind, detail) values (new.id, 'booking_change', d);
  end if;
  return null;
end;
$$;
create trigger inquiries_zz_audit after update on public.inquiries
  for each row execute function private.audit_inquiry();

create function private.audit_quote() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_events (inquiry_id, quote_id, kind, detail)
    values (new.inquiry_id, new.id, 'quote_created', jsonb_build_object('quote_number', new.quote_number, 'version', new.version));
  elsif old.status is distinct from new.status or old.total is distinct from new.total then
    insert into public.booking_events (inquiry_id, quote_id, kind, detail)
    values (new.inquiry_id, new.id, 'quote_change', jsonb_build_object('quote_number', new.quote_number, 'version', new.version,
      'status', jsonb_build_array(old.status, new.status), 'total', jsonb_build_array(old.total, new.total),
      'accepted_reference', new.accepted_reference));
  end if;
  return null;
end;
$$;
create trigger booking_quotes_zz_audit after insert or update on public.booking_quotes
  for each row execute function private.audit_quote();

-- 5. Accepting a quote now records how the customer accepted. It never confirms a booking.
drop function public.accept_quote(uuid);
create function public.accept_quote(p_quote_id uuid, p_reference text, p_accepted_on date default current_date)
returns jsonb language plpgsql set search_path = '' as $$
declare q public.booking_quotes;
begin
  if not private.is_admin() then
    raise exception 'Only RAAHA admins can accept quotes.';
  end if;
  if nullif(trim(coalesce(p_reference, '')), '') is null then
    raise exception 'Record how the customer accepted (for example: “Email reply from customer, Nov 3”).';
  end if;
  select * into q from public.booking_quotes where id = p_quote_id for update;
  if q.id is null then raise exception 'Quote not found.'; end if;
  if q.status not in ('draft', 'sent') then raise exception 'Only a draft or sent quote can be accepted.'; end if;
  if q.total <= 0 then raise exception 'A $0 quote cannot be accepted.'; end if;
  perform set_config('raaha.accepting', 'on', true);
  update public.booking_quotes set status = 'superseded'
   where inquiry_id = q.inquiry_id and id <> q.id and status in ('draft', 'sent', 'accepted');
  update public.booking_quotes
     set status = 'accepted', responded_on = coalesce(p_accepted_on, current_date), accepted_reference = left(trim(p_reference), 300)
   where id = q.id;
  perform set_config('raaha.accepting', 'off', true);
  update public.inquiries
     set quote_amount = q.total,
         status = case when status in ('new', 'contacted', 'quoted') then 'quote_accepted' else status end
   where id = q.inquiry_id;
  return jsonb_build_object('inquiry_id', q.inquiry_id, 'total', q.total);
end;
$$;
revoke execute on function public.accept_quote(uuid, text, date) from public, anon;
grant execute on function public.accept_quote(uuid, text, date) to authenticated;

-- 6. Balance follows the accepted quote minus the verified deposit (never changes a recorded payment).
--    Recording a verified deposit on an accepted quote moves the booking to "Deposit verified".
create function private.recompute_balance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare acc numeric; dep_ok boolean;
begin
  dep_ok := coalesce(new.deposit_amount, 0) > 0 and new.deposit_received_on is not null
            and nullif(trim(coalesce(new.payment_reference, '')), '') is not null;
  select total into acc from public.booking_quotes where inquiry_id = new.id and status = 'accepted' order by version desc limit 1;
  if acc is not null and new.balance_received_on is null and (
       old.quote_amount is distinct from new.quote_amount or old.deposit_amount is distinct from new.deposit_amount
       or old.deposit_received_on is distinct from new.deposit_received_on or new.balance_amount is null) then
    new.balance_amount := greatest(0, acc - case when new.deposit_received_on is not null then coalesce(new.deposit_amount, 0) else 0 end);
  end if;
  if new.status = 'quote_accepted' and old.status = 'quote_accepted' and dep_ok then
    new.status := 'deposit_verified';
  end if;
  return new;
end;
$$;
create trigger inquiries_balance before update on public.inquiries
  for each row execute function private.recompute_balance();

-- Recalculate when a quote is accepted (accept_quote updates the booking, which runs the trigger above)

-- 7. Deposit verified requires the recorded deposit (no exceptions)
create function private.require_verified_deposit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'deposit_verified' and not (coalesce(new.deposit_amount, 0) > 0 and new.deposit_received_on is not null
       and nullif(trim(coalesce(new.payment_reference, '')), '') is not null) then
    raise exception 'Deposit verified needs the deposit amount, the date received and the payment reference.';
  end if;
  return new;
end;
$$;
create trigger inquiries_deposit_check before insert or update on public.inquiries
  for each row execute function private.require_verified_deposit();

-- 8. Confirmation rules, enforced in the database for every path (including two clicks at the same moment):
--    an accepted quote is required, and the event may not overlap another confirmed event or an unavailable date.
create function private.guard_confirmation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c record; b record;
begin
  if new.status <> 'confirmed' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'confirmed' and old.event_date is not distinct from new.event_date
     and old.event_start_time is not distinct from new.event_start_time and old.event_end_time is not distinct from new.event_end_time then
    return new;
  end if;
  if not exists (select 1 from public.booking_quotes where inquiry_id = new.id and status = 'accepted') then
    raise exception 'A booking can be confirmed only after a quote is accepted.';
  end if;
  if new.event_date is null then
    raise exception 'Add the event date before confirming.';
  end if;
  perform pg_advisory_xact_lock(hashtext('raaha.calendar'));   -- one confirmation check at a time
  select * into b from public.calendar_blocks where new.event_date between starts_on and ends_on limit 1;
  if b.id is not null then
    raise exception 'Not confirmed: % is marked unavailable (%). Remove the block or change the date first.', to_char(new.event_date, 'Mon DD, YYYY'), b.label;
  end if;
  for c in select i.name, i.event_start_time, i.event_end_time from public.inquiries i
            where i.id <> new.id and i.status = 'confirmed' and i.event_date = new.event_date and i.is_test = new.is_test loop
    if new.event_start_time is null or new.event_end_time is null or c.event_start_time is null or c.event_end_time is null then
      raise exception 'Not confirmed: another confirmed event (%) is on the same day and the times are not both set. Add start and end times, or change the date.', c.name;
    end if;
    if new.event_start_time < c.event_end_time and c.event_start_time < new.event_end_time then
      raise exception 'Not confirmed: the event overlaps the confirmed event “%” (% – %).', c.name,
        to_char(c.event_start_time, 'HH12:MI AM'), to_char(c.event_end_time, 'HH12:MI AM');
    end if;
  end loop;
  return new;
end;
$$;
create trigger inquiries_conflicts before insert or update on public.inquiries
  for each row execute function private.guard_confirmation();

-- 9. Automatic acknowledgment of genuine inquiries (off until the owner switches it on in Settings)
alter table public.site_settings add column auto_ack_enabled boolean not null default false;
-- Admins may change only this one setting (the website-publishing switch stays locked)
revoke update on public.site_settings from authenticated;
grant update (auto_ack_enabled, updated_at) on public.site_settings to authenticated;
create policy "admins update auto-acknowledgment" on public.site_settings for update to authenticated
  using (private.is_admin()) with check (private.is_admin());
create function public.set_auto_ack(p_enabled boolean) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Only RAAHA admins can change this setting.'; end if;
  update public.site_settings set auto_ack_enabled = p_enabled, updated_at = now() where id = true;
  return p_enabled;
end;
$$;
revoke execute on function public.set_auto_ack(boolean) from public, anon;
grant execute on function public.set_auto_ack(boolean) to authenticated;

create extension if not exists pg_net with schema extensions;
create function private.queue_inquiry_ack() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_test or not coalesce((select auto_ack_enabled from public.site_settings where id = true), false) then
    return null;
  end if;
  begin
    perform net.http_post(
      url := 'https://csoxstrjofgxnnlbshoc.supabase.co/functions/v1/raaha-email/ack',
      body := jsonb_build_object('inquiry_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 8000);
  exception when others then
    null;   -- never block a customer's inquiry because the email hook is unavailable
  end;
  return null;
end;
$$;
create trigger inquiries_ack after insert on public.inquiries
  for each row execute function private.queue_inquiry_ack();

commit;
