import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore } from './local.ts';
import type { StoredTransaction } from './types.ts';

class MemoryStorage {
  data = new Map<string, string>();
  quota = Infinity;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.quota) throw new Error('QuotaExceededError');
    this.data.set(k, v);
  }
}

const tx = (id: string, uploadId: string): StoredTransaction => ({
  id,
  uploadId,
  fingerprint: id,
  source: 'card',
  date: '2026-10-01',
  merchant: 'NETFLIX.COM',
  amount: 17000,
  direction: 'out',
});
const upload = (id: string) => ({ id, name: `${id}.csv`, kind: 'card' as const, institution: '신한카드', count: 1, createdAt: 'x' });

test('이 브라우저 저장소: 파일을 지우면 그 파일의 거래만 지워진다', async () => {
  const storage = new MemoryStorage();
  const store = new LocalStore(storage as unknown as Storage);
  await store.addUpload(upload('a'), [tx('a-1', 'a')], []);
  await store.addUpload(upload('b'), [tx('b-1', 'b')], []);
  await store.saveEdit('netflix', { memo: '가족', updatedAt: 'x' });
  await store.removeUpload('a');
  const s = await new LocalStore(storage as unknown as Storage).load();
  assert.deepEqual(s.transactions.map((t) => t.id), ['b-1']);
  assert.equal(s.edits.netflix.memo, '가족');
  await store.saveEdit('netflix', null);
  await store.clear();
  assert.deepEqual(await store.load(), { uploads: [], transactions: [], emails: [], edits: {}, manual: [] });
});

test('저장 공간이 모자라면 알아들을 수 있는 오류를 낸다', async () => {
  const storage = new MemoryStorage();
  storage.quota = 10;
  const store = new LocalStore(storage as unknown as Storage);
  await assert.rejects(store.addUpload(upload('a'), [tx('a-1', 'a')], []), /저장 공간/);
});
