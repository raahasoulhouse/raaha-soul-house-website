-- RAAHA website content management (additive: does not touch inquiries, notes, admin users or auth).
--
-- Every editable item (text, links, photos, menu, events, galleries, FAQs, lists) lives in cms_entries:
--   draft      what the admin is editing (admins only)
--   published  what the PREVIEW website shows
--   live       what the PRODUCTION website will show (empty until launch is approved)
-- Photos: uploads go to the PRIVATE bucket 'media-private'. Only when content using a photo is
-- published is a copy placed in the PUBLIC bucket 'site-media'.

-- ---------- settings (production publishing switch, OFF) ----------
create table public.site_settings (
    id boolean primary key default true check (id),           -- single row
    production_publishing_enabled boolean not null default false,
    updated_at timestamptz not null default now()
);
insert into public.site_settings (id) values (true);

-- ---------- media library ----------
create table public.media (
    id uuid primary key default gen_random_uuid(),
    path text not null unique,          -- same file name in both buckets
    thumb_path text,
    alt_text text check (char_length(alt_text) <= 300),
    description text check (char_length(description) <= 1000),
    folder text not null default 'general'
        check (folder in ('general', 'homepage', 'menu', 'events', 'gallery', 'coffee-cart')),
    width integer, height integer, bytes integer,
    public_copy boolean not null default false,   -- true once copied to the public bucket
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid()
);

-- ---------- content ----------
create table public.cms_entries (
    id uuid primary key default gen_random_uuid(),
    collection text not null check (collection in (
        'text', 'image', 'toggle', 'link',
        'menu_category', 'menu_item', 'event', 'gallery', 'experience',
        'faq', 'service_area', 'offering', 'feature_card', 'space_highlight', 'cart_fact')),
    key text check (char_length(key) <= 120),
    sort integer not null default 0,
    draft jsonb,
    draft_deleted boolean not null default false,
    published jsonb,
    published_source jsonb,
    live jsonb,
    live_source jsonb,
    updated_at timestamptz not null default now(),
    updated_by uuid default auth.uid(),
    published_at timestamptz,
    live_at timestamptz,
    unique (collection, key)
);
create index cms_entries_collection_idx on public.cms_entries (collection, sort);

create trigger cms_touch before update on public.cms_entries
for each row execute function private.touch_updated_at();

-- every publish keeps a snapshot of what was visible BEFORE it, so it can be undone
create table public.publish_log (
    id bigint generated always as identity primary key,
    published_at timestamptz not null default now(),
    published_by uuid default auth.uid(),
    target text not null check (target in ('preview', 'production', 'rollback')),
    changed integer not null default 0,
    removed integer not null default 0,
    snapshot jsonb not null
);

-- ---------- access rules ----------
alter table public.site_settings enable row level security;
alter table public.media enable row level security;
alter table public.cms_entries enable row level security;
alter table public.publish_log enable row level security;

-- visitors: published/live copies only; never drafts, media records, settings or history
revoke all on public.cms_entries, public.media, public.publish_log, public.site_settings from anon;
grant select (id, collection, key, sort, published, live) on public.cms_entries to anon;
create policy "visitors read published content" on public.cms_entries
    for select to anon using (published is not null or live is not null);

create policy "admins manage content" on public.cms_entries
    for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admins manage media" on public.media
    for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admins read publish log" on public.publish_log
    for select to authenticated using (private.is_admin());
create policy "admins read settings" on public.site_settings
    for select to authenticated using (private.is_admin());
-- no insert/update policies on settings or the log: only the functions below (and RAAHA's
-- Supabase owner account) can change them
revoke insert, update, delete on public.site_settings, public.publish_log from authenticated;

-- ---------- helpers ----------
create or replace function private.content_snapshot(p_target text)
returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'collection', collection, 'key', key, 'sort', sort,
        'value', case when p_target = 'production' then live else published end,
        'source', case when p_target = 'production' then live_source else published_source end)), '[]'::jsonb)
    from public.cms_entries
    where (case when p_target = 'production' then live else published end) is not null;
$$;

create or replace function private.log_publish(p_target text, p_changed int, p_removed int, p_snapshot jsonb)
returns void language sql security definer set search_path = '' as $$
    insert into public.publish_log (target, changed, removed, snapshot)
    values (p_target, p_changed, p_removed, p_snapshot);
$$;
revoke all on function private.content_snapshot(text), private.log_publish(text, int, int, jsonb) from public, anon;
grant execute on function private.content_snapshot(text), private.log_publish(text, int, int, jsonb) to authenticated;

-- ---------- publish drafts to the PREVIEW website ----------
create or replace function public.publish_site()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    v_snapshot jsonb;
    v_changed integer := 0;
    v_n integer;
    v_removed integer;
begin
    if not private.is_admin() then
        raise exception 'Only RAAHA admins can publish.';
    end if;
    v_snapshot := private.content_snapshot('preview');

    -- items deleted in the draft: remove from preview (rows stay if production still uses them)
    delete from public.cms_entries where draft_deleted and live is null;
    get diagnostics v_removed = row_count;
    update public.cms_entries set published = null, published_source = null, draft = null
     where draft_deleted and live is not null;
    get diagnostics v_n = row_count;
    v_removed := v_removed + v_n;

    -- items with a photo: attach the photo's public file and alt text
    update public.cms_entries e
       set published = e.draft || jsonb_build_object(
               'src', m.path, 'thumb', coalesce(m.thumb_path, m.path),
               'alt', coalesce(nullif(e.draft->>'alt', ''), m.alt_text, ''),
               'w', m.width, 'h', m.height),
           published_source = e.draft,
           published_at = now()
      from public.media m
     where m.id = nullif(e.draft->>'media_id', '')::uuid
       and m.public_copy
       and (e.draft is distinct from e.published_source
            or e.published->>'src' is distinct from m.path
            or e.published->>'alt' is distinct from coalesce(nullif(e.draft->>'alt', ''), m.alt_text, ''));
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;

    if exists (select 1 from public.cms_entries e
               where nullif(e.draft->>'media_id', '') is not null
                 and e.draft is distinct from e.published_source
                 and not exists (select 1 from public.media m
                                 where m.id = (e.draft->>'media_id')::uuid and m.public_copy)) then
        raise exception 'A photo used in a draft is missing or not ready for publishing. Re-select the photo and try again.';
    end if;

    -- everything else
    update public.cms_entries e
       set published = e.draft, published_source = e.draft, published_at = now()
     where e.draft is not null
       and e.draft is distinct from e.published_source;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;

    perform private.log_publish('preview', v_changed, v_removed, v_snapshot);
    return jsonb_build_object('target', 'preview', 'changed', v_changed, 'removed', v_removed);
end;
$$;

-- ---------- undo the last preview publish ----------
create or replace function public.rollback_preview(p_log_id bigint)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    v_snap jsonb;
    v_current jsonb;
begin
    if not private.is_admin() then
        raise exception 'Only RAAHA admins can roll back.';
    end if;
    select snapshot into v_snap from public.publish_log where id = p_log_id and target in ('preview', 'rollback');
    if v_snap is null then
        raise exception 'That publish could not be found.';
    end if;
    v_current := private.content_snapshot('preview');

    -- hide everything that was not visible at that point
    update public.cms_entries e set published = null, published_source = null
     where not exists (select 1 from jsonb_array_elements(v_snap) s where (s->>'id')::uuid = e.id);
    -- restore rows that still exist
    update public.cms_entries e
       set published = s.value->'value', published_source = s.value->'source', sort = (s.value->>'sort')::int
      from jsonb_array_elements(v_snap) s(value)
     where (s.value->>'id')::uuid = e.id;
    -- recreate rows that were deleted since (their draft comes back too)
    insert into public.cms_entries (id, collection, key, sort, draft, published, published_source)
    select (s->>'id')::uuid, s->>'collection', s->>'key', (s->>'sort')::int, s->'source', s->'value', s->'source'
      from jsonb_array_elements(v_snap) s
     where not exists (select 1 from public.cms_entries e where e.id = (s->>'id')::uuid);

    perform private.log_publish('rollback', jsonb_array_length(v_snap), 0, v_current);
    return jsonb_build_object('restored_to', p_log_id);
end;
$$;

-- ---------- discard unpublished drafts ----------
create or replace function public.discard_drafts()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    v_reverted integer;
    v_dropped integer;
begin
    if not private.is_admin() then
        raise exception 'Only RAAHA admins can discard drafts.';
    end if;
    delete from public.cms_entries where published_source is null and live_source is null;
    get diagnostics v_dropped = row_count;
    update public.cms_entries
       set draft = published_source, draft_deleted = false
     where draft is distinct from published_source or draft_deleted;
    get diagnostics v_reverted = row_count;
    return jsonb_build_object('reverted', v_reverted, 'dropped', v_dropped);
end;
$$;

-- ---------- PRODUCTION publishing (disabled until launch is approved) ----------
create or replace function public.publish_production()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
    v_snapshot jsonb;
    v_n integer;
begin
    if not private.is_admin() then
        raise exception 'Only RAAHA admins can publish.';
    end if;
    if not (select production_publishing_enabled from public.site_settings) then
        raise exception 'Production publishing is turned off until the website launch is approved.';
    end if;
    v_snapshot := private.content_snapshot('production');
    update public.cms_entries set live = published, live_source = published_source, live_at = now()
     where live is distinct from published;
    get diagnostics v_n = row_count;
    perform private.log_publish('production', v_n, 0, v_snapshot);
    return jsonb_build_object('target', 'production', 'changed', v_n);
end;
$$;

revoke all on function public.publish_site(), public.rollback_preview(bigint), public.discard_drafts(),
                       public.publish_production() from public, anon;
grant execute on function public.publish_site(), public.rollback_preview(bigint), public.discard_drafts(),
                          public.publish_production() to authenticated;

-- ---------- photo storage ----------
-- private: every upload (drafts). Max 5 MB per file, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media-private', 'media-private', false, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;
-- public: only copies of photos used by published content
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "admins read raaha media" on storage.objects
    for select to authenticated using (bucket_id in ('media-private', 'site-media') and private.is_admin());
create policy "admins upload raaha media" on storage.objects
    for insert to authenticated with check (bucket_id in ('media-private', 'site-media') and private.is_admin());
create policy "admins update raaha media" on storage.objects
    for update to authenticated using (bucket_id in ('media-private', 'site-media') and private.is_admin());
create policy "admins delete raaha media" on storage.objects
    for delete to authenticated using (bucket_id in ('media-private', 'site-media') and private.is_admin());
