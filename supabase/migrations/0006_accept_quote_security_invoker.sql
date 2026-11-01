-- 0006: tightening applied 2026-10-31 right after 0005 (Supabase security advisor).
-- accept_quote runs with the signed-in admin's own permissions (row security applies) instead of elevated rights.
-- It still refuses anyone who is not on the admin list. Rollback: not needed (0005's rollback drops the function).
alter function public.accept_quote(uuid) security invoker;
