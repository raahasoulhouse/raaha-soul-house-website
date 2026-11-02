-- Rollback of 0007_booking_email_operations. Download the Admin backup first:
-- this removes the email history, the booking audit trail and the acknowledgment setting.
-- Bookings in the new steps are moved back to the nearest earlier step so the old status rule can return.
begin;
drop trigger if exists inquiries_ack on public.inquiries;
drop function if exists private.queue_inquiry_ack();
drop function if exists public.set_auto_ack(boolean);
drop policy if exists "admins update auto-acknowledgment" on public.site_settings;
alter table public.site_settings drop column if exists auto_ack_enabled;
drop trigger if exists inquiries_conflicts on public.inquiries;
drop function if exists private.guard_confirmation();
drop trigger if exists inquiries_deposit_check on public.inquiries;
drop function if exists private.require_verified_deposit();
drop trigger if exists inquiries_balance on public.inquiries;
drop function if exists private.recompute_balance();
drop trigger if exists inquiries_zz_audit on public.inquiries;
drop function if exists private.audit_inquiry();
drop trigger if exists booking_quotes_zz_audit on public.booking_quotes;
drop function if exists private.audit_quote();
drop table if exists public.booking_events;
drop table if exists public.email_log;
drop function if exists public.accept_quote(uuid, text, date);
create function public.accept_quote(p_quote_id uuid) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare q public.booking_quotes;
begin
  if not private.is_admin() then raise exception 'Only RAAHA admins can accept quotes.'; end if;
  select * into q from public.booking_quotes where id = p_quote_id for update;
  if q.id is null then raise exception 'Quote not found.'; end if;
  if q.status not in ('draft', 'sent') then raise exception 'Only a draft or sent quote can be accepted.'; end if;
  perform set_config('raaha.accepting', 'on', true);
  update public.booking_quotes set status = 'superseded'
   where inquiry_id = q.inquiry_id and id <> q.id and status in ('draft', 'sent', 'accepted');
  update public.booking_quotes set status = 'accepted', responded_on = current_date where id = q.id;
  perform set_config('raaha.accepting', 'off', true);
  update public.inquiries set quote_amount = q.total,
         status = case when status in ('new', 'contacted') then 'quoted' else status end
   where id = q.inquiry_id;
  return jsonb_build_object('inquiry_id', q.inquiry_id, 'total', q.total);
end;
$$;
revoke execute on function public.accept_quote(uuid) from public, anon;
grant execute on function public.accept_quote(uuid) to authenticated;
alter table public.booking_quotes drop column if exists accepted_reference;
update public.inquiries set status = 'quoted' where status in ('quote_accepted', 'deposit_verified');
alter table public.inquiries drop constraint inquiries_status_check;
alter table public.inquiries add constraint inquiries_status_check check (status in
  ('new', 'contacted', 'quoted', 'confirmed', 'completed', 'declined', 'lost'));
commit;
