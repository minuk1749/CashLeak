/** bank: 통장, card: 카드 이용내역, pay: 카카오페이·네이버페이 같은 간편결제 내역 */
export type TxSource = 'bank' | 'card' | 'pay';
export type Mailbox = 'gmail' | 'naver';
export type Cycle = 'monthly' | 'yearly';
export type Currency = 'KRW' | 'USD';
/** 실제 서비스 대신 가맹점명에 찍히는 결제 중개자 (앱스토어, 간편결제, 결제대행사) */
export type Intermediary = 'apple' | 'google' | 'naverpay' | 'kakaopay' | 'tosspay' | 'pg';
/** 간편결제 내역의 거래 종류 */
export type TxKind = 'payment' | 'topup' | 'transfer' | 'refund';

/** 은행·카드·간편결제 내역 한 줄을 공통 형태로 바꾼 것 */
export interface Transaction {
  id: string;
  source: TxSource;
  /** 내역을 낸 곳 (농협은행, 신한카드, 카카오페이 등) */
  institution?: string;
  date: string; // YYYY-MM-DD (KST)
  time?: string; // HH:MM:SS
  merchant: string; // 가맹점명 또는 적요 원문
  amount: number; // 원화 금액, 항상 양수
  direction: 'out' | 'in';
  method?: string; // 거래유형: 일시불, 체크카드, 자동이체, CMS, 이체 등
  memo?: string;
  foreignAmount?: number;
  foreignCurrency?: Currency;
  /** 간편결제 내역의 거래 종류 */
  kind?: TxKind;
  /** 간편결제 내역의 결제수단 원문 (예: 농협 계좌, 신한카드, 카카오페이머니) */
  funding?: string;
  /** 다른 내역과 맞춰 본 돈의 경로 (예: ['농협은행 계좌', '카카오페이']). reconcile 후에 채워진다. */
  path?: string[];
  /** 같은 결제로 확인돼 이 거래에 합쳐진 다른 내역의 id */
  linkedIds?: string[];
}

export interface EmailMessage {
  id: string;
  mailbox: Mailbox;
  from: string;
  subject: string;
  date: string; // ISO 8601
  text: string;
}

export type ReceiptType = 'charge' | 'cancel' | 'upcoming';

/** 메일 한 통에서 뽑아낸 구독 결제 정보 */
export interface EmailReceipt {
  emailId: string;
  mailbox: Mailbox;
  type: ReceiptType;
  serviceId: string;
  serviceName: string;
  date: string; // YYYY-MM-DD (KST)
  amount?: number;
  currency?: Currency;
  cycle?: Cycle;
  nextDate?: string;
  billedVia?: Intermediary;
  duplicateOf?: string;
}

export type SeriesKind = 'subscription' | 'bill' | 'transfer';

export interface PriceChange {
  date: string;
  from: number;
  to: number;
  currency: Currency;
}

/** 거래내역에서 찾은 반복 결제 묶음 */
export interface RecurringSeries {
  id: string;
  key: string; // 정규화된 가맹점 키
  merchant: string; // 가장 최근 거래의 가맹점명 원문
  serviceId?: string;
  via?: Intermediary;
  kind: SeriesKind;
  cycle: Cycle;
  anchorDay: number; // 월 단위면 결제 기준일, 연 단위면 기준 월*100+일
  transactions: Transaction[];
  amount: number; // 최근 원화 금액
  foreignAmount?: number;
  foreignCurrency?: Currency;
  amountVaries: boolean;
  priceChanges: PriceChange[];
  /** 같은 가맹점에서 이 묶음에 속하지 않은 결제 수 (많으면 우연히 겹친 금액일 수 있음) */
  otherPaymentsAtMerchant: number;
  /** 결제 간격: 주기대로(regular), 한 번 건너뜀(skipped), 주기에 안 맞음(irregular) */
  gaps: { regular: number; skipped: number; irregular: number };
  firstDate: string;
  lastDate: string;
  nextDate: string;
  active: boolean;
}

export type SubscriptionStatus = 'active' | 'canceled' | 'suspected_canceled';
export type ConfidenceLabel = '높음' | '보통' | '낮음';
export type EvidenceSource = TxSource | Mailbox;

export interface Subscription {
  id: string;
  key: string; // 서비스 ID 또는 가맹점 키
  serviceId?: string;
  name: string;
  category: string;
  /** 돈이 빠져나가는 경로 (서비스 이름 제외). 예: ['농협은행 계좌', '카카오페이'] */
  paymentPath: string[];
  kind: 'subscription' | 'bill';
  status: SubscriptionStatus;
  cycle: Cycle;
  amount?: number; // 최근 원화 결제 금액
  amountVaries: boolean;
  foreignAmount?: number;
  foreignCurrency?: Currency;
  lastPaymentDate?: string;
  nextPaymentDate?: string;
  confidence: number; // 0~1
  confidenceLabel: ConfidenceLabel;
  sources: EvidenceSource[];
  transactionIds: string[];
  emailIds: string[];
  notes: string[];
}

export interface ExcludedGroup {
  merchant: string;
  reason: string;
  count: number;
  total: number;
}

export interface DetectionResult {
  asOf: string;
  subscriptions: Subscription[];
  recurringTransfers: RecurringSeries[];
  excluded: ExcludedGroup[];
  /** 여러 내역을 맞춰 중복을 합친 실제 결제 목록 (페이 충전 같은 내부 이동 제외) */
  ledger: Transaction[];
  /** 페이 충전처럼 내 돈이 자리만 옮긴 거래 */
  internal: Transaction[];
  stats: {
    transactions: number;
    /** 다른 내역과 같은 결제로 확인돼 합쳐진 거래 수 */
    mergedTransactions: number;
    topups: number;
    emails: number;
    receipts: number;
    duplicateReceipts: number;
  };
}
