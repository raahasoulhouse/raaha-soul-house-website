-- RAAHA: Coffee Cart inquiries + private admin access
-- Public visitors can only ADD an inquiry. Only allowlisted, email-confirmed admins can read or change data.

create extension if not exists pgcrypto;

-- Who may use the admin portal (matched to a confirmed Supabase Auth account)
create table public.admin_users (
    email text primary key check (email = lower(email)),
    created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
-- no policies: not readable or writable through the public API

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.admin_users a
        join auth.users u on lower(u.email) = a.email
        where u.id = auth.uid()
          and u.email_confirmed_at is not null
    );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

create table public.inquiries (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    -- what the visitor submitted
    inquiry_type text not null default 'coffee_cart' check (inquiry_type in ('coffee_cart', 'gathering')),
    name text not null check (char_length(name) between 1 and 120),
    email text not null check (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    phone text check (char_length(phone) <= 40),
    event_type text check (char_length(event_type) <= 80),
    event_date date,
    guest_count integer check (guest_count between 1 and 5000),
    service_duration text check (char_length(service_duration) <= 80),
    city_neighborhood text check (char_length(city_neighborhood) <= 120),
    venue_address text check (char_length(venue_address) <= 240),
    message text check (char_length(message) <= 4000),

    -- where it came from
    heard_about text check (char_length(heard_about) <= 80),
    utm_source text check (char_length(utm_source) <= 120),
    utm_medium text check (char_length(utm_medium) <= 120),
    utm_campaign text check (char_length(utm_campaign) <= 120),
    referrer text check (char_length(referrer) <= 500),
    landing_page text check (char_length(landing_page) <= 500),

    -- managed by RAAHA in the admin portal
    status text not null default 'new'
        check (status in ('new', 'contacted', 'quoted', 'confirmed', 'completed', 'declined', 'lost')),
    follow_up_on date,
    quote_amount numeric(10, 2) check (quote_amount >= 0),
    deposit_amount numeric(10, 2) check (deposit_amount >= 0),
    deposit_received_on date,
    closed_reason text check (char_length(closed_reason) <= 500),
    is_test boolean not null default false
);
create index inquiries_created_at_idx on public.inquiries (created_at desc);
create index inquiries_status_idx on public.inquiries (status);

create table public.inquiry_notes (
    id uuid primary key default gen_random_uuid(),
    inquiry_id uuid not null references public.inquiries (id) on delete cascade,
    body text not null check (char_length(body) between 1 and 4000),
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid()
);
create index inquiry_notes_inquiry_idx on public.inquiry_notes (inquiry_id, created_at);

-- keep updated_at current
create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
    new.updated_at := now();
    return new;
end;
$$;
create trigger inquiries_touch before update on public.inquiries
for each row execute function public.touch_updated_at();

-- public submissions: force safe defaults and limit floods
create or replace function public.guard_public_inquiry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
    if public.is_admin() then
        return new;
    end if;
    -- visitors can never set business fields
    new.status := 'new';
    new.follow_up_on := null;
    new.quote_amount := null;
    new.deposit_amount := null;
    new.deposit_received_on := null;
    new.closed_reason := null;
    new.created_at := now();
    -- simple flood protection
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
create trigger inquiries_guard before insert on public.inquiries
for each row execute function public.guard_public_inquiry();

-- Row level security
alter table public.inquiries enable row level security;
alter table public.inquiry_notes enable row level security;

create policy "public can submit inquiries" on public.inquiries
    for insert to anon, authenticated with check (true);
create policy "admins read inquiries" on public.inquiries
    for select to authenticated using (public.is_admin());
create policy "admins update inquiries" on public.inquiries
    for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "admins delete inquiries" on public.inquiries
    for delete to authenticated using (public.is_admin());

create policy "admins manage notes" on public.inquiry_notes
    for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Column-level limits for the public role: only the visitor fields can be written
revoke all on public.inquiries from anon;
grant insert (inquiry_type, name, email, phone, event_type, event_date, guest_count, service_duration,
              city_neighborhood, venue_address, message, heard_about, utm_source, utm_medium,
              utm_campaign, referrer, landing_page, is_test)
    on public.inquiries to anon;
revoke all on public.inquiry_notes from anon;
revoke all on public.admin_users from anon, authenticated;

insert into public.admin_users (email) values ('raahasoulhouse@gmail.com');
