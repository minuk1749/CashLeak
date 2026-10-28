import { cloudConfigured, supabase } from '../supabase.ts';
import { LocalStore } from './local.ts';
import { SupabaseStore } from './supabase.ts';
import type { DataStore } from './types.ts';

export function createStore(): DataStore {
  return cloudConfigured ? new SupabaseStore(supabase()) : new LocalStore();
}

export * from './types.ts';
