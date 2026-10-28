// Supabase 저장소를 실제 PostgreSQL(마이그레이션 + 행 수준 보안)에 연결해 왕복 시험한다.
// PostgREST 대신 이 시험에서 쓰는 메서드만 SQL로 옮기는 작은 가짜 클라이언트를 쓴다.
// PGHOST 등 PostgreSQL 접속 환경 변수가 있을 때만 돈다 (CI에서는 postgres 서비스로 실행).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runPipeline } from '@cashleak/engine';
import { SupabaseStore } from './supabase.ts';
import { parseFile } from '../files.ts';
import { sampleFiles } from '../demo.ts';
import type { Snapshot } from './types.ts';

const enabled = Boolean(process.env.PGHOST || process.env.PGDATABASE);
const root = fileURLToPath(new URL('../../../../supabase/', import.meta.url));

function psql(db: string, sql: string, user?: string): string {
  const auth = user ? `set local role authenticated; set local request.jwt.claims = '{"sub": "${user}"}';` : '';
  const input = `begin; ${auth} ${sql}; commit;`;
  return execFileSync('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-qAt'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

const literal = (json: unknown) => `$json$${JSON.stringify(json)}$json$`;

/** 이 저장소가 쓰는 supabase-js 쿼리만 흉내 낸다. 서버가 한 번에 100행까지만 준다고 가정해 나눠 읽기도 시험한다. */
function fakeClient(db: string, user: string): SupabaseClient {
  const from = (table: string) => {
    const q = {
      op: 'select' as 'select' | 'insert' | 'upsert' | 'delete',
      columns: '*',
      rows: [] as Record<string, unknown>[],
      conflict: undefined as string | undefined,
      filters: [] as [string, unknown][],
      orders: [] as string[],
      span: undefined as [number, number] | undefined,
      select(columns: string) { q.columns = columns; return q; },
      order(column: string) { q.orders.push(column); return q; },
      range(a: number, b: number) { q.span = [a, b]; return q; },
      insert(rows: object | object[]) { q.op = 'insert'; q.rows = [rows].flat() as Record<string, unknown>[]; return q; },
      upsert(rows: object | object[], options?: { onConflict?: string }) {
        q.op = 'upsert';
        q.rows = [rows].flat() as Record<string, unknown>[];
        q.conflict = options?.onConflict ?? 'id';
        return q;
      },
      delete() { q.op = 'delete'; return q; },
      eq(column: string, value: unknown) { q.filters.push([column, value]); return q; },
      then(resolve: (r: { data: unknown; error: { message: string } | null }) => unknown) {
        try {
          return Promise.resolve(resolve({ data: run(), error: null }));
        } catch (e) {
          return Promise.resolve(resolve({ data: null, error: { message: (e as Error).message } }));
        }
      },
    };
    const where = () => (q.filters.length ? ` where ${q.filters.map(([c, v]) => `${c} = ${literal(v).replace(/^\$json\$"?|"?\$json\$$/g, "'")}`).join(' and ')}` : '');
    const run = () => {
      const t = `public.${table}`;
      if (q.op === 'select') {
        const [a, b] = q.span ?? [0, 99];
        const limit = Math.min(b - a + 1, 100);
        const order = q.orders.length ? ` order by ${q.orders.join(', ')}` : '';
        return JSON.parse(psql(db, `select coalesce(json_agg(r), '[]') from (select ${q.columns} from ${t}${order} limit ${limit} offset ${a}) r`, user));
      }
      if (q.op === 'delete') return psql(db, `delete from ${t}${where()}`, user) && null;
      const cols = Object.keys(q.rows[0]);
      const insert = `insert into ${t} (${cols.join(', ')}) select ${cols.join(', ')} from json_populate_recordset(null::${t}, ${literal(q.rows)})`;
      const upsert = q.op === 'upsert' ? ` on conflict (${q.conflict}) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}` : '';
      psql(db, insert + upsert, user);
      return null;
    };
    return q;
  };
  const auth = { getSession: async () => ({ data: { session: { user: { id: user } } } }) };
  return { from, auth } as unknown as SupabaseClient;
}

const comparable = (s: Snapshot) => ({
  uploads: [...s.uploads].sort((a, b) => a.id.localeCompare(b.id)),
  transactions: [...s.transactions].sort((a, b) => a.id.localeCompare(b.id)),
  emails: [...s.emails].map((m) => ({ ...m, date: new Date(m.date).toISOString() })).sort((a, b) => a.id.localeCompare(b.id)),
  edits: s.edits,
  manual: s.manual,
});
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));

test('Supabase 저장소: 올린 내역·수정 내용이 그대로 저장되고 다시 읽은 탐지 결과도 같다', { skip: !enabled && 'PostgreSQL 접속 정보(PGHOST)가 없어 건너뜀' }, () => {
  const db = `cashleak_test_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  execFileSync('psql', ['-d', 'postgres', '-qc', `create database ${db}`]);
  return (async () => {
    try {
      for (const file of ['tests/auth-stub.sql', 'migrations/0001_init.sql']) {
        execFileSync('psql', ['-d', db, '-v', 'ON_ERROR_STOP=1', '-q', '-f', root + file]);
      }
      const [a, b] = [randomUUID(), randomUUID()];
      psql(db, `insert into auth.users (id) values ('${a}'), ('${b}')`);
      const store = new SupabaseStore(fakeClient(db, a));

      const expected: Snapshot = { uploads: [], transactions: [], emails: [], edits: {}, manual: [] };
      const seen = new Set<string>();
      for (const file of sampleFiles()) {
        const parsed = parseFile(file, seen, randomUUID(), '2026-10-27T00:00:00.000Z');
        await store.addUpload(parsed.upload, parsed.transactions, parsed.emails);
        expected.uploads.push(parsed.upload);
        expected.transactions.push(...parsed.transactions);
        expected.emails.push(...parsed.emails);
      }
      const edit = { memo: '가족 요금제', status: 'active' as const, updatedAt: '2026-10-27T00:00:00.000Z' };
      await store.saveEdit('melon', edit);
      await store.saveEdit('melon', { ...edit, memo: '혼자 씀' });
      expected.edits.melon = { ...edit, memo: '혼자 씀' };
      const manual = { id: randomUUID(), name: '헬스장', amount: 77000, cycle: 'monthly' as const, nextPaymentDate: '2026-11-01', paymentPath: ['농협은행 계좌'], createdAt: '2026-10-27T00:00:00.000Z' };
      await store.saveManual(manual);
      expected.manual.push(manual);

      const loaded = await store.load();
      assert.ok(loaded.transactions.length > 100, '100행보다 많아야 나눠 읽기를 시험할 수 있다');
      assert.deepEqual(plain(comparable(loaded)), plain(comparable(expected)));

      const detect = (s: Snapshot) => runPipeline({ transactions: s.transactions, emails: s.emails }).subscriptions.map((x) => [x.key, x.amount, x.nextPaymentDate, x.paymentPath.join('>')]);
      assert.deepEqual(detect(loaded), detect(expected));

      // 다른 사용자에게는 아무것도 보이지 않는다.
      const other = await new SupabaseStore(fakeClient(db, b)).load();
      assert.equal(other.uploads.length + other.transactions.length + other.manual.length, 0);

      // 파일을 지우면 그 파일의 거래도 지워지고, 모두 지우기는 남김없이 지운다.
      await store.removeUpload(expected.uploads[0].id);
      const afterRemove = await store.load();
      assert.equal(afterRemove.transactions.some((t) => t.uploadId === expected.uploads[0].id), false);
      await store.saveEdit('melon', null);
      await store.clear();
      const empty = await store.load();
      assert.equal(empty.uploads.length + empty.transactions.length + empty.emails.length + empty.manual.length + Object.keys(empty.edits).length, 0);
    } finally {
      execFileSync('psql', ['-d', 'postgres', '-qc', `drop database if exists ${db} with (force)`]);
    }
  })();
});
