-- 이미 운영 중인 DB용: 대여 기록 수정/반납을 본인 또는 관리자만 하도록 제한
-- Supabase Dashboard -> SQL Editor 에서 한 번 실행하세요.
drop policy if exists loans_update_public on public.loans;
drop policy if exists loans_update_owner_or_admin on public.loans;

create policy loans_update_owner_or_admin
on public.loans for update to anon, authenticated
using (user_id = (select auth.uid()) or (select public.is_admin()))
with check (user_id = (select auth.uid()) or (select public.is_admin()));
