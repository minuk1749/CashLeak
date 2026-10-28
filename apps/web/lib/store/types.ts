import type { Cycle, EmailMessage, Transaction, TxSource } from '@cashleak/engine';

export type FileKind = TxSource | 'email';

/** 올린 파일 한 개 */
export interface UploadRecord {
  id: string;
  name: string;
  kind: FileKind;
  /** 농협은행, 신한카드, 카카오페이, Gmail 등 */
  institution: string;
  /** 이 파일로 새로 추가된 줄 수 (이미 올린 내역과 겹친 줄은 빠짐) */
  count: number;
  firstDate?: string;
  lastDate?: string;
  createdAt: string;
}

export interface StoredTransaction extends Transaction {
  uploadId: string;
  /** 같은 내역을 두 번 올려도 한 번만 저장하기 위한 값 */
  fingerprint: string;
}

export interface StoredEmail extends EmailMessage {
  uploadId: string;
  fingerprint: string;
}

/** 탐지 결과를 사용자가 직접 고친 내용 */
export interface SubscriptionEdit {
  name?: string;
  amount?: number;
  cycle?: Cycle;
  nextPaymentDate?: string;
  /** active: 구독이 맞다고 확인, canceled: 해지했다고 표시 */
  status?: 'active' | 'canceled';
  /** 구독이 아니라서 목록에서 숨김 */
  hidden?: boolean;
  memo?: string;
  updatedAt: string;
}

/** 탐지되지 않아 직접 추가한 구독 */
export interface ManualSubscription {
  id: string;
  name: string;
  amount: number;
  cycle: Cycle;
  nextPaymentDate: string;
  paymentPath: string[];
  memo?: string;
  createdAt: string;
}

export interface Snapshot {
  uploads: UploadRecord[];
  transactions: StoredTransaction[];
  emails: StoredEmail[];
  /** 키: 구독 uid */
  edits: Record<string, SubscriptionEdit>;
  manual: ManualSubscription[];
}

export const emptySnapshot = (): Snapshot => ({ uploads: [], transactions: [], emails: [], edits: {}, manual: [] });

/** 저장소: 이 브라우저(localStorage) 또는 Supabase */
export interface DataStore {
  readonly mode: 'local' | 'cloud';
  load(): Promise<Snapshot>;
  addUpload(upload: UploadRecord, transactions: StoredTransaction[], emails: StoredEmail[]): Promise<void>;
  removeUpload(id: string): Promise<void>;
  /** edit 가 null 이면 고친 내용을 지운다. */
  saveEdit(uid: string, edit: SubscriptionEdit | null): Promise<void>;
  saveManual(sub: ManualSubscription): Promise<void>;
  removeManual(id: string): Promise<void>;
  clear(): Promise<void>;
}
