'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { runPipeline, type DetectionResult } from '@cashleak/engine';
import { createStore, emptySnapshot, type DataStore, type ManualSubscription, type Snapshot, type SubscriptionEdit } from './store/index.ts';
import { cloudConfigured, supabase } from './supabase.ts';
import { parseFile, type FileInput, type ParsedFile } from './files.ts';
import { buildViews, type SubscriptionView } from './view.ts';
import { todayKst } from './format.ts';
import { uuid } from './ids.ts';

export type Status = 'loading' | 'ready' | 'signed-out' | 'error';

interface DataContextValue {
  status: Status;
  error?: string;
  mode: 'local' | 'cloud';
  userEmail?: string;
  snapshot: Snapshot;
  /** 저장된 내역으로 돌린 탐지 결과. 내역이 없으면 null */
  result: DetectionResult | null;
  views: SubscriptionView[];
  today: string;
  addFiles(files: FileInput[]): Promise<ParsedFile[]>;
  removeUpload(id: string): Promise<void>;
  saveEdit(uid: string, edit: SubscriptionEdit | null): Promise<void>;
  saveManual(sub: ManualSubscription): Promise<void>;
  removeManual(id: string): Promise<void>;
  loadDemo(): Promise<void>;
  clearAll(): Promise<void>;
  signOut(): Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('DataProvider 안에서만 쓸 수 있습니다.');
  return value;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const fingerprintsOf = (s: Snapshot) => new Set([...s.transactions.map((t) => t.fingerprint), ...s.emails.map((m) => m.fingerprint)]);

export function DataProvider({ children }: { children: ReactNode }) {
  // 저장소는 브라우저에서만 만든다 (서버 렌더링 중에는 localStorage가 없다).
  const storeRef = useRef<DataStore | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string>();
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [session, setSession] = useState<Session | null>(null);
  const [today] = useState(todayKst);

  const store = () => (storeRef.current ??= createStore());

  const reload = useCallback(async () => {
    try {
      setSnapshot(await store().load());
      setError(undefined);
      setStatus('ready');
    } catch (e) {
      setError(message(e));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    if (!cloudConfigured) {
      void reload();
      return;
    }
    const { data } = supabase().auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (next) void reload();
      else {
        setSnapshot(emptySnapshot());
        setStatus('signed-out');
      }
    });
    return () => data.subscription.unsubscribe();
  }, [reload]);

  /** 저장한 뒤 다시 읽어 와서 화면을 맞춘다. 실패하면 호출한 화면에서 오류를 보여 준다. */
  const mutate = useCallback(
    async <T,>(fn: (s: DataStore) => Promise<T>): Promise<T> => {
      try {
        return await fn(store());
      } finally {
        await reload();
      }
    },
    [reload],
  );

  const addFiles = useCallback(
    (files: FileInput[]) =>
      mutate(async (s) => {
        const existing = fingerprintsOf(snapshot);
        const results: ParsedFile[] = [];
        for (const file of files) {
          const parsed = parseFile(file, existing, uuid());
          for (const t of parsed.transactions) existing.add(t.fingerprint);
          for (const m of parsed.emails) existing.add(m.fingerprint);
          if (parsed.upload.count > 0) await s.addUpload(parsed.upload, parsed.transactions, parsed.emails);
          results.push(parsed);
        }
        return results;
      }),
    [mutate, snapshot],
  );

  const loadDemo = useCallback(
    () =>
      mutate(async (s) => {
        const { sampleFiles } = await import('./demo.ts');
        await s.clear();
        const existing = new Set<string>();
        for (const file of sampleFiles()) {
          const parsed = parseFile(file, existing, uuid());
          await s.addUpload(parsed.upload, parsed.transactions, parsed.emails);
        }
      }),
    [mutate],
  );

  const result = useMemo(
    () => (snapshot.transactions.length || snapshot.emails.length ? runPipeline({ transactions: snapshot.transactions, emails: snapshot.emails }) : null),
    [snapshot],
  );
  const views = useMemo(() => buildViews(snapshot, result, today), [snapshot, result, today]);

  const value: DataContextValue = {
    status,
    error,
    mode: cloudConfigured ? 'cloud' : 'local',
    userEmail: session?.user.email,
    snapshot,
    result,
    views,
    today,
    addFiles,
    loadDemo,
    removeUpload: (id) => mutate((s) => s.removeUpload(id)),
    saveEdit: (uid, edit) => mutate((s) => s.saveEdit(uid, edit)),
    saveManual: (sub) => mutate((s) => s.saveManual(sub)),
    removeManual: (id) => mutate((s) => s.removeManual(id)),
    clearAll: () => mutate((s) => s.clear()),
    signOut: async () => {
      await supabase().auth.signOut();
    },
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
