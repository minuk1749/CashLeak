import { emptySnapshot, type DataStore, type ManualSubscription, type Snapshot, type StoredEmail, type StoredTransaction, type SubscriptionEdit, type UploadRecord } from './types.ts';

const KEY = 'cashleak:v1';

/** 로그인 없이 이 브라우저에만 저장한다. 다른 기기와 공유되지 않는다. */
export class LocalStore implements DataStore {
  readonly mode = 'local';
  private storage: Storage | undefined;

  constructor(storage: Storage | undefined = typeof window === 'undefined' ? undefined : window.localStorage) {
    this.storage = storage;
  }

  private read(): Snapshot {
    try {
      const raw = this.storage?.getItem(KEY);
      return raw ? { ...emptySnapshot(), ...(JSON.parse(raw) as Partial<Snapshot>) } : emptySnapshot();
    } catch {
      return emptySnapshot();
    }
  }

  private write(snapshot: Snapshot) {
    if (!this.storage) throw new Error('이 브라우저에서는 저장할 수 없습니다.');
    try {
      this.storage.setItem(KEY, JSON.stringify(snapshot));
    } catch {
      throw new Error('브라우저 저장 공간이 부족하거나 저장이 막혀 있습니다. 사생활 보호 모드라면 일반 창에서 열어 주세요.');
    }
  }

  private update(fn: (s: Snapshot) => void) {
    const s = this.read();
    fn(s);
    this.write(s);
  }

  async load() {
    return this.read();
  }

  async addUpload(upload: UploadRecord, transactions: StoredTransaction[], emails: StoredEmail[]) {
    this.update((s) => {
      s.uploads.push(upload);
      s.transactions.push(...transactions);
      s.emails.push(...emails);
    });
  }

  async removeUpload(id: string) {
    this.update((s) => {
      s.uploads = s.uploads.filter((u) => u.id !== id);
      s.transactions = s.transactions.filter((t) => t.uploadId !== id);
      s.emails = s.emails.filter((m) => m.uploadId !== id);
    });
  }

  async saveEdit(uid: string, edit: SubscriptionEdit | null) {
    this.update((s) => {
      if (edit) s.edits[uid] = edit;
      else delete s.edits[uid];
    });
  }

  async saveManual(sub: ManualSubscription) {
    this.update((s) => {
      s.manual = [...s.manual.filter((m) => m.id !== sub.id), sub];
    });
  }

  async removeManual(id: string) {
    this.update((s) => {
      s.manual = s.manual.filter((m) => m.id !== id);
    });
  }

  async clear() {
    this.write(emptySnapshot());
  }
}
