# Supabase 연결 (선택)

환경 변수가 없으면 앱은 로그인 없이 이 브라우저에만 저장하는 모드로 동작합니다. 아이폰과 컴퓨터처럼 여러 기기에서 같은 데이터를 보려면 Supabase를 연결합니다.

> Supabase 대시보드의 메뉴 이름은 바뀔 수 있습니다. 아래는 2026년 10월 기준입니다.

## 1. 프로젝트 만들기

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다. 지역은 가까운 곳(Northeast Asia (Seoul))을 고릅니다.
2. **SQL Editor**에서 새 쿼리를 열고 [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) 내용을 붙여 넣어 실행합니다.
   - 표 5개(올린 파일, 거래, 메일, 구독 수정, 직접 추가한 구독)와 행 수준 보안(RLS) 정책이 만들어집니다.
   - 로그인한 사용자는 자기 행만 읽고 쓸 수 있고, 로그인하지 않은 요청은 아무것도 읽지 못합니다. 이 동작은 [`supabase/tests/rls.test.sql`](../supabase/tests/rls.test.sql)로 시험합니다.

## 2. 로그인 설정

**Authentication → Sign In / Providers**에서:

- **Email** 공급자가 켜져 있는지 확인합니다. 앱은 이메일과 비밀번호로 로그인합니다 (아이폰 홈 화면 앱에서는 메일 링크 로그인이 잘 동작하지 않아서).
- **Confirm email**을 켜 두면 가입할 때 확인 메일이 옵니다. 메일의 링크를 누른 뒤 앱으로 돌아와 로그인하면 됩니다. 링크가 돌아갈 주소는 **Authentication → URL Configuration**의 **Site URL**이므로 앱 주소(개발 중에는 `http://localhost:3000`)로 맞춥니다.
- 혼자 쓸 거라면 내 계정을 만든 뒤 **Allow new users to sign up**을 꺼서 다른 사람이 가입하지 못하게 합니다.

## 3. 앱에 키 넣기

1. 프로젝트 화면 위쪽의 **Connect** 버튼이나 **Settings → API Keys**에서 Project URL과 **publishable key**(`sb_publishable_…`)를 복사합니다.
2. `apps/web/.env.example`을 `apps/web/.env.local`로 복사하고 값을 채웁니다.

   ```
   NEXT_PUBLIC_SUPABASE_URL=https://<프로젝트 ID>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

   예전 프로젝트라 `anon` 키(`eyJ`로 시작하는 긴 키)만 있다면 `NEXT_PUBLIC_SUPABASE_ANON_KEY`에 넣어도 됩니다.
3. `npm run dev`를 다시 실행하면 로그인 화면이 나옵니다.

## 주의

- **secret key(`sb_secret_…`)나 `service_role` 키는 앱이나 `.env.local`에 넣지 마세요.** 이 키는 행 수준 보안을 건너뛰어 모든 사용자의 데이터를 읽을 수 있습니다. 앱은 publishable key만 씁니다.
- `.env.local`은 git에 올라가지 않습니다 (`apps/web/.gitignore`).
- 브라우저 저장 모드에서 넣은 데이터는 Supabase로 옮겨지지 않습니다. 연결한 뒤 내역 파일을 다시 올리면 됩니다.
- 거래내역 파일은 브라우저에서 읽고, 정리된 거래 행과 메일 내용만 DB에 저장합니다. 원본 파일은 올리지 않습니다.
- 무료 플랜 프로젝트는 오래 쓰지 않으면 일시 정지될 수 있습니다. 대시보드에서 다시 켤 수 있습니다.
- 이 저장 방식은 로컬 PostgreSQL과 시험용 클라이언트로 확인했고, 실제 Supabase 프로젝트에서는 아직 돌려 보지 않았습니다.
