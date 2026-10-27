import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 두 값이 없으면 로그인 없이 이 브라우저에만 저장하는 모드로 동작한다.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const cloudConfigured = Boolean(url && key);

let client: SupabaseClient | undefined;

export function supabase(): SupabaseClient {
  if (!url || !key) throw new Error('Supabase 설정(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)이 없습니다.');
  client ??= createClient(url, key);
  return client;
}
