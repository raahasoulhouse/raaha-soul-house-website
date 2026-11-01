-- 0005_booking_management.sql — additive only; no existing row, column, policy or history entry is changed.
-- NOT YET APPLIED. Runs only with the owner's separate approval. Rollback: 0005_booking_management_rollback.sql
begin;

-- 1. Event times and manual payment tracking on existing booking records (all optional, all empty to start)
alter table public.inquiries
  add column event_start_time time,
  add column event_end_time time,
  add column deposit_due_on date,
  add column balance_amount numeric(10,2) check (balance_amount >= 0),
  add column balance_due_on date,
  add column balance_received_on date,
  add column balance_reference text check (char_length(balance_reference) <= 120);

-- 2. Custom quotes: versions per booking. Every line, quantity and price is typed by an admin; nothing is pre-priced.
create table public.booking_quotes (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.inquiries(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'declined', 'expired', 'superseded')),
  guest_count integer check (guest_count between 1 and 5000),
  service_duration text check (char_length(service_duration) <= 80),
  beverages jsonb not null default '[]'::jsonb check (jsonb_typeof(beverages) = 'array'),
  line_items jsonb not null default '[]'::jsonb check (jsonb_typeof(line_items) = 'array'),
  travel_fee numeric(10,2) not null default 0 check (travel_fee >= 0),
  discount numeric(10,2) not null default 0 check (discount >= 0),
  subtotal numeric(10,2) not null default 0,
  total numeric(10,2) not null default 0 check (total >= 0),
  valid_until date,
  sent_on date,
  responded_on date,
  client_notes text check (char_length(client_notes) <= 4000),
  internal_notes text check (char_length(internal_notes) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (inquiry_id, version)
);
create index booking_quotes_inquiry_idx on public.booking_quotes (inquiry_id);

-- Totals are always computed by the database from the typed lines (never trusted from the browser)
create function private.compute_quote_totals() returns trigger
language plpgsql set search_path = '' as $$
declare s numeric := 0;
begin
  if exists (select 1 from jsonb_array_elements(new.line_items) li
             where coalesce((li->>'qty')::numeric, 0) < 0 or coalesce((li->>'unit_price')::numeric, 0) < 0) then
    raise exception 'Quantities and prices cannot be negative. Use the discount field instead.';
  end if;
  select coalesce(sum(round(coalesce((li->>'qty')::numeric, 0) * coalesce((li->>'unit_price')::numeric, 0), 2)), 0)
    into s from jsonb_array_elements(new.line_items) li;
  new.subtotal := s;
  new.total := s + new.travel_fee - new.discount;
  if new.total < 0 then
    raise exception 'A quote total cannot be negative.';
  end if;
  -- acceptance only through accept_quote(), never by a plain edit
  if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted')
     and coalesce(current_setting('raaha.accepting', true), '') <> 'on' then
    raise exception 'Use “Mark accepted” to accept a quote.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger booking_quotes_totals before insert or update on public.booking_quotes
  for each row execute function private.compute_quote_totals();

-- Accepting a quote: one deliberate admin action. Other versions are superseded; the booking records the
-- accepted total and moves to "Quote provided" at most. It never confirms a booking (the deposit rule still applies).
create function public.accept_quote(p_quote_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.booking_quotes;
begin
  if not private.is_admin() then
    raise exception 'Only RAAHA admins can accept quotes.';
  end if;
  select * into q from public.booking_quotes where id = p_quote_id for update;
  if q.id is null then
    raise exception 'Quote not found.';
  end if;
  if q.status not in ('draft', 'sent') then
    raise exception 'Only a draft or sent quote can be accepted.';
  end if;
  perform set_config('raaha.accepting', 'on', true);
  update public.booking_quotes set status = 'superseded'
   where inquiry_id = q.inquiry_id and id <> q.id and status in ('draft', 'sent', 'accepted');
  update public.booking_quotes set status = 'accepted', responded_on = current_date where id = q.id;
  perform set_config('raaha.accepting', 'off', true);
  update public.inquiries
     set quote_amount = q.total,
         status = case when status in ('new', 'contacted') then 'quoted' else status end
   where id = q.inquiry_id;
  return jsonb_build_object('inquiry_id', q.inquiry_id, 'total', q.total);
end;
$$;
revoke execute on function public.accept_quote(uuid) from public, anon;
grant execute on function public.accept_quote(uuid) to authenticated;

-- 3. Unavailable dates for the calendar
create table public.calendar_blocks (
  id uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on date not null,
  label text not null check (char_length(label) between 1 and 120),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (ends_on >= starts_on)
);

-- 4. Security: both new tables are private to the admin allow-list (same rule as bookings)
alter table public.booking_quotes enable row level security;
alter table public.calendar_blocks enable row level security;
revoke all on public.booking_quotes, public.calendar_blocks from anon;
create policy "admins manage quotes" on public.booking_quotes
  for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admins manage calendar blocks" on public.calendar_blocks
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- 5. Public booking form guard: the new staff-only fields are also cleared on every public submission
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
    new.event_start_time := null;
    new.event_end_time := null;
    new.deposit_due_on := null;
    new.balance_amount := null;
    new.balance_due_on := null;
    new.balance_received_on := null;
    new.balance_reference := null;
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
