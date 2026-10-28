-- 행 수준 보안 시험: psql -v ON_ERROR_STOP=1 -f auth-stub.sql -f ../migrations/0001_init.sql -f rls.test.sql
-- 실패하면 예외로 멈춘다. 마지막에 모두 되돌린다.
begin;

insert into auth.users (id) values
  ('00000000-0000-4000-8000-00000000000a'),
  ('00000000-0000-4000-8000-00000000000b');

-- 사용자 A가 파일 하나와 거래 두 건을 올린다. user_id 는 기본값(auth.uid())으로 채워진다.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a"}';
insert into public.uploads (id, name, kind, institution) values ('10000000-0000-4000-8000-000000000001', 'nh-bank.csv', 'bank', '농협은행');
insert into public.transactions (id, upload_id, fingerprint, source, institution, date, time, merchant, amount, direction, method)
values
  ('a-1', '10000000-0000-4000-8000-000000000001', 'bank|1', 'bank', '농협은행', '2026-10-16', '12:00:07', '카카오페이', 10900, 'out', '간편결제'),
  ('a-2', '10000000-0000-4000-8000-000000000001', 'bank|2', 'bank', '농협은행', '2026-10-25', null, '(주)테크컴퍼니', 3200000, 'in', '급여');
insert into public.subscription_edits (key, data) values ('melon', '{"memo": "가족 요금제", "updatedAt": "2026-10-27T00:00:00Z"}');
insert into public.manual_subscriptions (id, name, amount, cycle, next_payment_date, payment_path)
values ('20000000-0000-4000-8000-000000000001', '헬스장', 77000, 'monthly', '2026-11-01', '{농협은행 계좌}');

do $$
begin
  if (select count(*) from public.transactions) <> 2 then raise exception 'A가 자기 거래를 못 봄'; end if;
  if (select user_id from public.uploads) <> '00000000-0000-4000-8000-00000000000a' then raise exception 'user_id 기본값이 auth.uid()가 아님'; end if;
end $$;

-- 같은 지문의 거래는 두 번 들어가지 않는다.
do $$
begin
  insert into public.transactions (id, upload_id, fingerprint, source, date, merchant, amount, direction)
  values ('a-3', '10000000-0000-4000-8000-000000000001', 'bank|1', 'bank', '2026-10-16', '카카오페이', 10900, 'out');
  raise exception '중복 지문이 들어감';
exception when unique_violation then null;
end $$;

-- 사용자 B는 A의 행을 보거나 고치거나 지울 수 없다.
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000b"}';
do $$
declare n int;
begin
  if (select count(*) from public.uploads) + (select count(*) from public.transactions)
     + (select count(*) from public.subscription_edits) + (select count(*) from public.manual_subscriptions) <> 0 then
    raise exception 'B가 A의 행을 봄';
  end if;
  update public.transactions set amount = 0;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B가 A의 거래를 고침'; end if;
  delete from public.uploads;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'B가 A의 파일을 지움'; end if;
end $$;

-- B가 A의 이름으로 행을 넣을 수 없다.
do $$
begin
  insert into public.uploads (id, user_id, name, kind, institution)
  values ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-00000000000a', 'x.csv', 'bank', 'x');
  raise exception 'B가 A 이름으로 파일을 넣음';
exception when insufficient_privilege then null;
end $$;

-- B가 자기 거래를 A의 파일에 붙일 수 없다 (복합 외래 키).
do $$
begin
  insert into public.transactions (id, upload_id, fingerprint, source, date, merchant, amount, direction)
  values ('b-1', '10000000-0000-4000-8000-000000000001', 'x', 'card', '2026-10-01', 'x', 1, 'out');
  raise exception 'B의 거래가 A의 파일에 붙음';
exception when foreign_key_violation then null;
end $$;

-- 로그인하지 않은 요청은 표에 접근할 수 없다.
reset request.jwt.claims;
set local role anon;
do $$
begin
  perform count(*) from public.uploads;
  raise exception 'anon이 표를 읽음';
exception when insufficient_privilege then null;
end $$;

-- A가 파일을 지우면 그 파일의 거래도 같이 지워진다.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-4000-8000-00000000000a"}';
delete from public.uploads where id = '10000000-0000-4000-8000-000000000001';
do $$
begin
  if (select count(*) from public.transactions) <> 0 then raise exception '파일을 지워도 거래가 남음'; end if;
end $$;

reset role;
select 'RLS 시험 통과' as result;
rollback;
