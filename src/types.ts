export type TxSource = 'bank' | 'card';
export type Mailbox = 'gmail' | 'naver';
export type Cycle = 'monthly' | 'yearly';
export type Currency = 'KRW' | 'USD';
/** 실제 서비스 대신 가맹점명에 찍히는 결제 중개자 */
export type Intermediary = 'apple' | 'google' | 'naverpay' | 'pg';

/** 은행·카드 내역 한 줄을 공통 형태로 바꾼 것 */
export interface Transaction {
  id: string;
  source: TxSource;
  date: string; // YYYY-MM-DD (KST)
  time?: string; // HH:MM:SS
  merchant: string; // 가맹점명 또는 적요 원문
  amount: number; // 원화 금액, 항상 양수
  direction: 'out' | 'in';
  method?: string; // 거래유형: 일시불, 체크카드, 자동이체, CMS, 이체 등
  memo?: string;
  foreignAmount?: number;
  foreignCurrency?: Currency;
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
  stats: {
    transactions: number;
    duplicateTransactions: number;
    emails: number;
    receipts: number;
    duplicateReceipts: number;
  };
}
