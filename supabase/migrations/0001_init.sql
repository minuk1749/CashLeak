-- CashLeak 초기 스키마
-- 모든 표에 주인(user_id)을 두고, 행 수준 보안(RLS)으로 로그인한 사용자가 자기 행만 읽고 쓰게 한다.
-- 거래·메일은 올린 파일(uploads)에 묶여 있어서 파일을 지우면 같이 지워진다.

create table public.uploads (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('bank', 'card', 'pay', 'email')),
  institution text not null,
  row_count integer not null default 0 check (row_count >= 0),
  first_date date,
  last_date date,
  created_at timestamptz not null default now(),
  -- 거래·메일이 다른 사람의 파일을 가리키지 못하도록 (user_id, id)로 참조한다.
  unique (user_id, id)
);

create table public.transactions (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  upload_id uuid not null,
  -- 같은 내역을 두 번 올려도 한 번만 저장하기 위한 값
  fingerprint text not null,
  source text not null check (source in ('bank', 'card', 'pay')),
  institution text,
  date date not null,
  time time,
  merchant text not null,
  amount numeric(14, 2) not null check (amount >= 0),
  direction text not null check (direction in ('in', 'out')),
  method text,
  memo text,
  foreign_amount numeric(14, 2),
  foreign_currency text check (foreign_currency in ('KRW', 'USD')),
  kind text check (kind in ('payment', 'topup', 'transfer', 'refund')),
  funding text,
  primary key (user_id, id),
  unique (user_id, fingerprint),
  foreign key (user_id, upload_id) references public.uploads (user_id, id) on delete cascade
);
create index transactions_upload_idx on public.transactions (user_id, upload_id);

create table public.email_messages (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  upload_id uuid not null,
  fingerprint text not null,
  mailbox text not null check (mailbox in ('gmail', 'naver')),
  sender text not null,
  subject text not null,
  sent_at timestamptz not null,
  body text not null,
  primary key (user_id, id),
  unique (user_id, fingerprint),
  foreign key (user_id, upload_id) references public.uploads (user_id, id) on delete cascade
);
create index email_messages_upload_idx on public.email_messages (user_id, upload_id);

-- 탐지 결과를 사용자가 고친 내용 (이름, 금액, 해지 표시, 숨김 등). key 는 앱의 구독 uid.
create table public.subscription_edits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- 탐지되지 않아 직접 추가한 구독
create table public.manual_subscriptions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  amount numeric(14, 2) not null check (amount > 0),
  cycle text not null check (cycle in ('monthly', 'yearly')),
  next_payment_date date not null,
  payment_path text[] not null default '{}',
  memo text,
  created_at timestamptz not null default now()
);
create index manual_subscriptions_user_idx on public.manual_subscriptions (user_id);
create index uploads_user_idx on public.uploads (user_id);

alter table public.uploads enable row level security;
alter table public.transactions enable row level security;
alter table public.email_messages enable row level security;
alter table public.subscription_edits enable row level security;
alter table public.manual_subscriptions enable row level security;

create policy "owner only" on public.uploads for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner only" on public.transactions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner only" on public.email_messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner only" on public.subscription_edits for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "owner only" on public.manual_subscriptions for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- 로그인하지 않은 요청(anon)에는 아무 권한도 주지 않는다.
revoke all on public.uploads, public.transactions, public.email_messages, public.subscription_edits, public.manual_subscriptions from anon;
grant select, insert, update, delete on public.uploads, public.transactions, public.email_messages, public.subscription_edits, public.manual_subscriptions to authenticated;
