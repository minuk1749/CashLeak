import type { SupabaseClient } from '@supabase/supabase-js';
import type { Currency, Cycle, Mailbox, TxKind, TxSource } from '@cashleak/engine';
import {
  emptySnapshot,
  type DataStore,
  type FileKind,
  type ManualSubscription,
  type Snapshot,
  type StoredEmail,
  type StoredTransaction,
  type SubscriptionEdit,
  type UploadRecord,
} from './types.ts';

// 테이블 정의는 supabase/migrations/0001_init.sql. 행 수준 보안(RLS)으로 각자 자기 행만 읽고 쓴다.

interface UploadRow {
  id: string;
  name: string;
  kind: FileKind;
  institution: string;
  row_count: number;
  first_date: string | null;
  last_date: string | null;
  created_at: string;
}

interface TransactionRow {
  id: string;
  upload_id: string;
  fingerprint: string;
  source: TxSource;
  institution: string | null;
  date: string;
  time: string | null;
  merchant: string;
  amount: number;
  direction: 'in' | 'out';
  method: string | null;
  memo: string | null;
  foreign_amount: number | null;
  foreign_currency: Currency | null;
  kind: TxKind | null;
  funding: string | null;
}

interface EmailRow {
  id: string;
  upload_id: string;
  fingerprint: string;
  mailbox: Mailbox;
  sender: string;
  subject: string;
  sent_at: string;
  body: string;
}

interface ManualRow {
  id: string;
  name: string;
  amount: number;
  cycle: Cycle;
  next_payment_date: string;
  payment_path: string[];
  memo: string | null;
  created_at: string;
}

/** Supabase API는 한 번에 정해진 행 수(기본 1000)까지만 돌려주므로 나눠서 읽는다. */
const PAGE = 1000;
const CHUNK = 500;

type Result<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function fetchAll<T>(query: (from: number, to: number) => Result<T>): Promise<T[]> {
  const rows: T[] = [];
  // 서버 설정이 PAGE보다 적게 돌려줘도 빠짐없이 읽도록, 받은 만큼 넘어가고 빈 페이지가 오면 멈춘다.
  for (;;) {
    const { data, error } = await query(rows.length, rows.length + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) return rows;
    rows.push(...data);
  }
}

function check<T extends { error: { message: string } | null }>(result: T): T {
  if (result.error) throw new Error(result.error.message);
  return result;
}

const orNull = <T>(v: T | undefined) => (v === undefined ? null : v);
const orUndefined = <T>(v: T | null) => (v === null ? undefined : v);

export class SupabaseStore implements DataStore {
  readonly mode = 'cloud';
  private client: SupabaseClient;

  constructor(client: SupabaseClient) {
    this.client = client;
  }

  private async userId(): Promise<string> {
    const { data } = await this.client.auth.getSession();
    const id = data.session?.user.id;
    if (!id) throw new Error('로그인이 필요합니다.');
    return id;
  }

  async load(): Promise<Snapshot> {
    const db = this.client;
    const [uploads, transactions, emails, edits, manual] = await Promise.all([
      fetchAll<UploadRow>((a, b) => db.from('uploads').select('*').order('created_at').order('id').range(a, b)),
      fetchAll<TransactionRow>((a, b) => db.from('transactions').select('*').order('id').range(a, b)),
      fetchAll<EmailRow>((a, b) => db.from('email_messages').select('*').order('id').range(a, b)),
      fetchAll<{ key: string; data: SubscriptionEdit }>((a, b) => db.from('subscription_edits').select('key, data').order('key').range(a, b)),
      fetchAll<ManualRow>((a, b) => db.from('manual_subscriptions').select('*').order('created_at').range(a, b)),
    ]);
    return {
      ...emptySnapshot(),
      uploads: uploads.map((u) => ({
        id: u.id,
        name: u.name,
        kind: u.kind,
        institution: u.institution,
        count: u.row_count,
        firstDate: orUndefined(u.first_date),
        lastDate: orUndefined(u.last_date),
        createdAt: new Date(u.created_at).toISOString(),
      })),
      transactions: transactions.map((t) => ({
        id: t.id,
        uploadId: t.upload_id,
        fingerprint: t.fingerprint,
        source: t.source,
        institution: orUndefined(t.institution),
        date: t.date,
        time: orUndefined(t.time),
        merchant: t.merchant,
        amount: Number(t.amount),
        direction: t.direction,
        method: orUndefined(t.method),
        memo: orUndefined(t.memo),
        foreignAmount: t.foreign_amount === null ? undefined : Number(t.foreign_amount),
        foreignCurrency: orUndefined(t.foreign_currency),
        kind: orUndefined(t.kind),
        funding: orUndefined(t.funding),
      })),
      emails: emails.map((m) => ({
        id: m.id,
        uploadId: m.upload_id,
        fingerprint: m.fingerprint,
        mailbox: m.mailbox,
        from: m.sender,
        subject: m.subject,
        date: m.sent_at,
        text: m.body,
      })),
      edits: Object.fromEntries(edits.map((e) => [e.key, e.data])),
      manual: manual.map((m) => ({
        id: m.id,
        name: m.name,
        amount: Number(m.amount),
        cycle: m.cycle,
        nextPaymentDate: m.next_payment_date,
        paymentPath: m.payment_path,
        memo: orUndefined(m.memo),
        createdAt: new Date(m.created_at).toISOString(),
      })),
    };
  }

  async addUpload(upload: UploadRecord, transactions: StoredTransaction[], emails: StoredEmail[]) {
    const user_id = await this.userId();
    check(
      await this.client.from('uploads').insert({
        id: upload.id,
        user_id,
        name: upload.name,
        kind: upload.kind,
        institution: upload.institution,
        row_count: upload.count,
        first_date: orNull(upload.firstDate),
        last_date: orNull(upload.lastDate),
        created_at: upload.createdAt,
      }),
    );
    try {
      for (let i = 0; i < transactions.length; i += CHUNK) {
        const rows = transactions.slice(i, i + CHUNK).map((t) => ({
          user_id,
          id: t.id,
          upload_id: t.uploadId,
          fingerprint: t.fingerprint,
          source: t.source,
          institution: orNull(t.institution),
          date: t.date,
          time: orNull(t.time),
          merchant: t.merchant,
          amount: t.amount,
          direction: t.direction,
          method: orNull(t.method),
          memo: orNull(t.memo),
          foreign_amount: orNull(t.foreignAmount),
          foreign_currency: orNull(t.foreignCurrency),
          kind: orNull(t.kind),
          funding: orNull(t.funding),
        }));
        check(await this.client.from('transactions').insert(rows));
      }
      for (let i = 0; i < emails.length; i += CHUNK) {
        const rows = emails.slice(i, i + CHUNK).map((m) => ({
          user_id,
          id: m.id,
          upload_id: m.uploadId,
          fingerprint: m.fingerprint,
          mailbox: m.mailbox,
          sender: m.from,
          subject: m.subject,
          sent_at: m.date,
          body: m.text,
        }));
        check(await this.client.from('email_messages').insert(rows));
      }
    } catch (e) {
      // 중간에 실패하면 반쯤 들어간 파일이 남지 않게 지운다.
      await this.client.from('uploads').delete().eq('id', upload.id);
      throw e;
    }
  }

  async removeUpload(id: string) {
    // 거래·메일은 외래 키(on delete cascade)로 같이 지워진다.
    check(await this.client.from('uploads').delete().eq('id', id));
  }

  async saveEdit(uid: string, edit: SubscriptionEdit | null) {
    const user_id = await this.userId();
    if (edit) {
      check(
        await this.client
          .from('subscription_edits')
          .upsert({ user_id, key: uid, data: edit, updated_at: edit.updatedAt }, { onConflict: 'user_id,key' }),
      );
    } else {
      check(await this.client.from('subscription_edits').delete().eq('user_id', user_id).eq('key', uid));
    }
  }

  async saveManual(sub: ManualSubscription) {
    const user_id = await this.userId();
    check(
      await this.client.from('manual_subscriptions').upsert({
        id: sub.id,
        user_id,
        name: sub.name,
        amount: sub.amount,
        cycle: sub.cycle,
        next_payment_date: sub.nextPaymentDate,
        payment_path: sub.paymentPath,
        memo: orNull(sub.memo),
        created_at: sub.createdAt,
      }),
    );
  }

  async removeManual(id: string) {
    check(await this.client.from('manual_subscriptions').delete().eq('id', id));
  }

  async clear() {
    const user_id = await this.userId();
    for (const table of ['uploads', 'subscription_edits', 'manual_subscriptions']) {
      check(await this.client.from(table).delete().eq('user_id', user_id));
    }
  }
}
