-- RAAHA website content management: drafts, publishing, media library.
-- Every editable item (text, images, menu, events, galleries, FAQs, lists) lives in cms_entries
-- with a DRAFT copy (what the admin edits) and a PUBLISHED copy (what visitors see).

create table public.media (
    id uuid primary key default gen_random_uuid(),
    path text not null unique,          -- storage path of the full-size web image
    thumb_path text,                    -- storage path of the small version
    alt_text text check (char_length(alt_text) <= 300),
    description text check (char_length(description) <= 1000),
    folder text not null default 'general' check (folder in ('general', 'homepage', 'menu', 'events', 'gallery', 'coffee-cart')),
    width integer, height integer, bytes integer,
    created_at timestamptz not null default now(),
    created_by uuid default auth.uid()
);

create table public.cms_entries (
    id uuid primary key default gen_random_uuid(),
    collection text not null check (collection in (
        'text', 'image', 'toggle',                      -- single named values (use key)
        'menu_category', 'menu_item', 'event', 'gallery',
        'faq', 'service_area', 'offering', 'feature_card', 'space_highlight', 'cart_fact', 'experience')),
    key text check (char_length(key) <= 120),
    sort integer not null default 0,
    draft jsonb,                        -- what the admin is editing
    draft_deleted boolean not null default false,
    published jsonb,                    -- what visitors see (images resolved to file paths)
    published_source jsonb,             -- the draft as it was when last published
    updated_at timestamptz not null default now(),
    updated_by uuid default auth.uid(),
    published_at timestamptz,
    unique (collection, key)
);
create index cms_entries_collection_idx on public.cms_entries (collection, sort);

create table public.publish_log (
    id bigint generated always as identity primary key,
    published_at timestamptz not null default now(),
    published_by uuid default auth.uid(),
    target text not null default 'preview' check (target in ('preview', 'production')),
    changed integer not null,
    removed integer not null
);

create trigger cms_touch before update on public.cms_entries
for each row execute function private.touch_updated_at();

-- ---------- access rules ----------
alter table public.media enable row level security;
alter table public.cms_entries enable row level security;
alter table public.publish_log enable row level security;

-- Visitors: may read ONLY the published copy of published entries. Never drafts, never media records.
revoke all on public.cms_entries from anon;
grant select (id, collection, key, sort, published) on public.cms_entries to anon;
create policy "visitors read published content" on public.cms_entries
    for select to anon using (published is not null);

-- Admin: full control
create policy "admins manage content" on public.cms_entries
    for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admins manage media" on public.media
    for all to authenticated using (private.is_admin()) with check (private.is_admin());
create policy "admins read publish log" on public.publish_log
    for select to authenticated using (private.is_admin());
create policy "admins write publish log" on public.publish_log
    for insert to authenticated with check (private.is_admin());
revoke all on public.media, public.publish_log from anon;

-- ---------- publish / discard (run with the admin's own permissions) ----------
create or replace function public.publish_site()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_changed integer;
    v_removed integer;
    v_removed_tmp integer;
begin
    if not private.is_admin() then
        raise exception 'Only RAAHA admins can publish.';
    end if;

    delete from public.cms_entries where draft_deleted;
    get diagnostics v_removed = row_count;

    -- entries that use a photo: copy the draft and attach the photo's file paths and alt text
    update public.cms_entries e
       set published = e.draft || jsonb_build_object(
               'src', m.path, 'thumb', coalesce(m.thumb_path, m.path),
               'alt', coalesce(nullif(e.draft->>'alt', ''), m.alt_text, ''),
               'w', m.width, 'h', m.height),
           published_source = e.draft,
           published_at = now()
      from public.media m
     where m.id = nullif(e.draft->>'media_id', '')::uuid
       and (e.draft is distinct from e.published_source          -- edited
            or e.published->>'src' is distinct from m.path         -- photo replaced in the library
            or e.published->>'alt' is distinct from coalesce(nullif(e.draft->>'alt', ''), m.alt_text, ''));
    get diagnostics v_changed = row_count;

    -- everything else: publish the draft as is
    update public.cms_entries e
       set published = e.draft,
           published_source = e.draft,
           published_at = now()
     where e.draft is distinct from e.published_source;
    get diagnostics v_removed_tmp = row_count;
    v_changed := v_changed + v_removed_tmp;

    insert into public.publish_log (target, changed, removed) values ('preview', v_changed, v_removed);
    return jsonb_build_object('changed', v_changed, 'removed', v_removed, 'target', 'preview');
end;
$$;

create or replace function public.discard_drafts()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    v_reverted integer;
    v_dropped integer;
begin
    if not private.is_admin() then
        raise exception 'Only RAAHA admins can discard drafts.';
    end if;
    delete from public.cms_entries where published_source is null;
    get diagnostics v_dropped = row_count;
    update public.cms_entries
       set draft = published_source, draft_deleted = false
     where draft is distinct from published_source or draft_deleted;
    get diagnostics v_reverted = row_count;
    return jsonb_build_object('reverted', v_reverted, 'dropped', v_dropped);
end;
$$;

revoke all on function public.publish_site(), public.discard_drafts() from public, anon;
grant execute on function public.publish_site(), public.discard_drafts() to authenticated;

-- ---------- photo storage ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('site-media', 'site-media', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "admins upload site media" on storage.objects
    for insert to authenticated with check (bucket_id = 'site-media' and private.is_admin());
create policy "admins update site media" on storage.objects
    for update to authenticated using (bucket_id = 'site-media' and private.is_admin());
create policy "admins delete site media" on storage.objects
    for delete to authenticated using (bucket_id = 'site-media' and private.is_admin());
