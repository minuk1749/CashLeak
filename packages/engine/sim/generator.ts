// 가상 사용자 한 명의 6개월치 내역을 만든다: 농협 통장, 신한카드, 카카오페이·네이버페이 이용내역, Gmail·네이버 메일함.
// 정답(truth)을 함께 만들어서 탐지 결과를 채점할 수 있게 한다.
import type { Currency, Cycle, EmailMessage, Mailbox, Transaction, TxKind } from '../src/types.ts';
import { addDays, addMonths, addYears, anchoredDate, diffDays, monthIndex, weekday, yearlyDate } from '../src/dates.ts';
import { appKey, INTERMEDIARY_BY_ID, matchMerchant } from '../src/merchants.ts';
import { createRng, type Rng } from './rng.ts';
import { NOISE, TEMPLATES, type Issuer, type MailContent } from './mail-templates.ts';

export const WINDOW_START = '2026-05-01';
export const AS_OF = '2026-10-26';
export const BANK = '농협은행';
export const CARD = '신한카드';
// 실제 주소가 아니라 영수증에 흔히 나오는 가려진 형태로 쓴다.
const ACCOUNTS: Record<Mailbox, string> = { gmail: 'us***@gmail.com', naver: 'us***@naver.com' };

type Platform = 'kakaopay' | 'naverpay';
export const PAY_NAME: Record<Platform, string> = { kakaopay: '카카오페이', naverpay: '네이버페이' };
/** 간편결제가 통장에서 돈을 가져갈 때 통장 내역에 찍히는 이름 */
const BANK_LABEL: Record<Platform, string> = { kakaopay: '카카오페이', naverpay: '네이버파이낸셜' };
/** 간편결제가 카드로 결제할 때 카드 이용내역에 찍히는 이름 */
const CARD_LABEL: Record<Platform, string> = { kakaopay: '카카오페이', naverpay: '네이버페이' };
type Funding = 'account' | 'card' | 'money';
const fundingText = (platform: Platform, funding: Funding) =>
  funding === 'account' ? '농협 계좌' : funding === 'card' ? CARD : `${PAY_NAME[platform]}머니`;

// 가상 데이터용 휴일 목록 (실제 공휴일과 다를 수 있음). 통장 자동이체는 다음 영업일로 밀린다.
const HOLIDAYS = new Set(['2026-05-05', '2026-05-25', '2026-06-03', '2026-08-17', '2026-09-24', '2026-09-25', '2026-10-05', '2026-10-09']);

function nextBusinessDay(date: string): string {
  let d = date;
  while (weekday(d) === 0 || weekday(d) === 6 || HOLIDAYS.has(d)) d = addDays(d, 1);
  return d;
}

type Channel = 'card' | 'bank-cms' | 'bank-autodebit' | 'pay';

interface SubTemplate {
  key: string;
  serviceId?: string;
  name: string;
  kind: 'subscription' | 'bill';
  cycle: Cycle;
  price: number;
  currency: Currency;
  raisedPrice?: number;
  variable?: [number, number];
  channel: Channel;
  /** 카드·통장에 찍히는 가맹점명, 간편결제면 페이 내역에 찍히는 이름 */
  merchant: string;
  platform?: Platform;
  funding?: Funding;
  maxDelay: number;
  issuer?: Issuer;
  receiptProb: number;
  appName?: string;
  itemName: string;
}

const sub = (t: Partial<SubTemplate> & Pick<SubTemplate, 'name' | 'merchant' | 'itemName'>): SubTemplate => ({
  key: t.serviceId ?? t.key ?? '',
  kind: 'subscription',
  cycle: 'monthly',
  price: 0,
  currency: 'KRW',
  channel: 'card',
  maxDelay: 0,
  receiptProb: 0,
  ...t,
});

export const CATALOG: SubTemplate[] = [
  sub({ serviceId: 'netflix', name: '넷플릭스', price: 13500, raisedPrice: 17000, merchant: 'NETFLIX.COM', issuer: 'netflix', receiptProb: 0.3, itemName: '스탠다드' }),
  sub({ serviceId: 'youtube-premium', name: '유튜브 프리미엄', price: 14900, merchant: 'GOOGLE*YOUTUBEPREMIUM', issuer: 'google', receiptProb: 0.9, itemName: 'YouTube Premium' }),
  sub({ serviceId: 'google-one', name: 'Google One', price: 2400, merchant: 'GOOGLE*GOOGLE ONE', issuer: 'google', receiptProb: 0.9, itemName: 'Google One 100GB' }),
  sub({ serviceId: 'chatgpt-plus', name: 'ChatGPT Plus', price: 20, currency: 'USD', merchant: 'OPENAI *CHATGPT SUBSCR', maxDelay: 1, issuer: 'openai', receiptProb: 1, itemName: 'ChatGPT Plus' }),
  sub({ serviceId: 'coupang-wow', name: '쿠팡 와우 멤버십', price: 7890, merchant: '쿠팡(와우멤버십)', issuer: 'coupang', receiptProb: 0.5, itemName: '와우 멤버십' }),
  sub({ serviceId: 'naver-plus', name: '네이버플러스 멤버십', price: 4900, channel: 'pay', platform: 'naverpay', funding: 'card', merchant: '네이버플러스 멤버십', issuer: 'naverpay', receiptProb: 0.9, itemName: '네이버플러스 멤버십' }),
  sub({ serviceId: 'melon', name: '멜론', price: 10900, channel: 'pay', platform: 'kakaopay', funding: 'account', merchant: '멜론', itemName: '멜론 스트리밍클럽' }),
  sub({ serviceId: 'emoticon-plus', name: '이모티콘 플러스', price: 3900, channel: 'pay', platform: 'kakaopay', funding: 'money', merchant: '이모티콘 플러스', itemName: '이모티콘 플러스' }),
  sub({ serviceId: 'icloud-plus', name: 'iCloud+', price: 1100, merchant: 'APPLE.COM/BILL', maxDelay: 2, issuer: 'apple', receiptProb: 1, appName: 'iCloud+', itemName: 'iCloud+ 50GB' }),
  sub({ serviceId: 'duolingo', name: '듀오링고 슈퍼', price: 13000, merchant: 'APPLE.COM/BILL', maxDelay: 2, issuer: 'apple', receiptProb: 1, appName: 'Duolingo', itemName: 'Duolingo Super' }),
  sub({ key: appKey('Bear Pro'), name: 'Bear Pro', price: 2500, merchant: 'APPLE.COM/BILL', maxDelay: 2, issuer: 'apple', receiptProb: 1, appName: 'Bear', itemName: 'Bear Pro' }),
  sub({ serviceId: 'disney-plus', name: '디즈니+', price: 9900, merchant: '디즈니플러스', issuer: 'disney', receiptProb: 0.6, itemName: '디즈니+ 스탠다드' }),
  sub({ serviceId: 'millie', name: '밀리의 서재', price: 9900, merchant: '(주)케이지이니시스', issuer: 'millie', receiptProb: 0.8, itemName: '밀리의 서재' }),
  sub({ serviceId: 'microsoft-365', name: 'Microsoft 365', cycle: 'yearly', price: 89000, merchant: 'MICROSOFT*STORE', issuer: 'microsoft', receiptProb: 1, itemName: 'Microsoft 365 Personal' }),
  sub({ serviceId: 'spotify', name: '스포티파이', price: 10900, merchant: 'SPOTIFY', issuer: 'spotify', receiptProb: 0.8, itemName: 'Spotify Premium Individual' }),
  sub({ serviceId: 'tving', name: '티빙', price: 9500, merchant: '티빙', issuer: 'tving', receiptProb: 0.5, itemName: '티빙 스탠다드' }),
  sub({ serviceId: 'baemin-club', name: '배민클럽', price: 3990, merchant: '배민클럽', issuer: 'baemin', receiptProb: 0.4, itemName: '배민클럽' }),
  sub({ serviceId: 'coway', name: '코웨이 렌탈', price: 29900, channel: 'bank-cms', merchant: '코웨이(주)', itemName: '정수기 렌탈' }),
  sub({ serviceId: 'skt', name: 'SK텔레콤 통신요금', kind: 'bill', variable: [52000, 61000], channel: 'bank-autodebit', merchant: 'SKT통신요금', issuer: 'skt', receiptProb: 0.6, itemName: '이동전화' }),
  sub({ key: 'm:핏앤짐 역삼점', name: '핏앤짐 역삼점', price: 77000, merchant: '핏앤짐 역삼점', itemName: '헬스장' }),
];

const byKey = new Map(CATALOG.map((t) => [t.key, t]));

interface Plan {
  t: SubTemplate;
  day: number; // 월 결제 기준일
  renewal?: string; // 연간 결제 기준일 (아무 해나 상관없음)
  startMonth: number; // 첫 결제 월 인덱스
  cancelAfter?: number; // 기간 안에서 이만큼 결제 후 해지
  raiseFrom?: number; // 이 번째 결제부터 인상된 가격
  mailbox: Mailbox;
  receiptProb: number;
  cancelMail: boolean;
  /** 실제 내역처럼 가맹점명 뒤에 승인·가맹점 번호가 붙거나 승인이 하루이틀 늦어지는 등의 흔들림 */
  noisy?: boolean;
}

export interface TruthEntry {
  key: string;
  name: string;
  kind: 'subscription' | 'bill';
  cycle: Cycle;
  status: 'active' | 'canceled';
  amount?: number;
  foreignAmount?: number;
  nextPaymentDate?: string;
  /** 돈이 나가는 경로 (서비스 이름 제외) */
  path: string[];
  charges: number;
  receipts: number;
  /** 원리상 찾을 수 있는지: 결제 흔적 2건 이상 또는 영수증 메일 1통 이상 */
  detectable: boolean;
}

export interface SimData {
  seed: number;
  start: string;
  asOf: string;
  transactions: Transaction[];
  emails: EmailMessage[];
  truth: TruthEntry[];
  /** 간편결제 이용내역도 올렸는지 */
  payHistories: boolean;
  /** 정답 연결: [간편결제 거래 id, 돈이 나온 통장·카드 거래 id] (간편결제 내역을 올린 경우만) */
  links: [string, string][];
}

const pad = (n: number) => String(n).padStart(2, '0');

class Builder {
  card: Transaction[] = [];
  bank: Transaction[] = [];
  pay: Transaction[] = [];
  emails: EmailMessage[] = [];
  links: [Transaction, Transaction][] = [];
  private balance: Record<Platform, number> = { kakaopay: 0, naverpay: 0 };
  private fxCache = new Map<string, number>();
  private rng: Rng;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  time(): string {
    const r = this.rng;
    return `${pad(r.int(7, 22))}:${pad(r.int(0, 59))}:${pad(r.int(0, 39))}`;
  }

  /** 같은 결제가 다른 내역에 몇 초 차이로 찍힌다. */
  near(time: string): string {
    const [h, m, s] = time.split(':').map(Number);
    return `${pad(h)}:${pad(m)}:${pad(s + this.rng.int(0, 20))}`;
  }

  /** 원/달러 환율 (날마다 조금씩 움직임) */
  fx(date: string): number {
    if (!this.fxCache.has(date)) this.fxCache.set(date, 1360 + this.rng.int(0, 80) + this.rng.next());
    return this.fxCache.get(date)!;
  }

  addCard(date: string, merchant: string, amount: number, extra: Partial<Transaction> = {}, time = this.time()): Transaction {
    const tx: Transaction = { id: '', source: 'card', institution: CARD, date, time, merchant, amount, direction: 'out', method: '일시불', ...extra };
    this.card.push(tx);
    return tx;
  }

  addBank(date: string, merchant: string, amount: number, direction: 'out' | 'in', method: string, memo?: string, time = this.time()): Transaction {
    const tx: Transaction = { id: '', source: 'bank', institution: BANK, date, time, merchant, amount, direction, method, memo };
    this.bank.push(tx);
    return tx;
  }

  /** 간편결제 한 건: 페이 이용내역과, 돈이 나온 통장·카드 내역(머니면 충전 내역)을 같이 만든다. */
  addPay(platform: Platform, date: string, merchant: string, amount: number, funding: Funding, kind: TxKind = 'payment'): Transaction {
    const time = this.time();
    const tx: Transaction = {
      id: '',
      source: 'pay',
      institution: PAY_NAME[platform],
      date,
      time,
      merchant,
      amount,
      direction: 'out',
      kind,
      funding: fundingText(platform, funding),
    };
    if (funding === 'money') {
      if (this.balance[platform] < amount) {
        // 잔액이 모자라면 1만 원 단위로 자동 충전된다.
        const charge = Math.ceil((amount - this.balance[platform]) / 10000) * 10000;
        const topup: Transaction = { ...tx, merchant: `${PAY_NAME[platform]}머니 충전`, amount: charge, direction: 'in', kind: 'topup', funding: '농협 계좌' };
        this.pay.push(topup);
        this.links.push([topup, this.addBank(date, BANK_LABEL[platform], charge, 'out', '간편결제', undefined, this.near(time))]);
        this.balance[platform] += charge;
      }
      this.balance[platform] -= amount;
    } else {
      const source =
        funding === 'account'
          ? this.addBank(date, BANK_LABEL[platform], amount, 'out', '간편결제', undefined, this.near(time))
          : this.addCard(date, CARD_LABEL[platform], amount, {}, this.near(time));
      this.links.push([tx, source]);
    }
    this.pay.push(tx);
    return tx;
  }

  addMail(mailbox: Mailbox, date: string, content: MailContent, dupProb = 0) {
    const iso = `${date}T${this.time()}+09:00`;
    this.emails.push({ id: '', mailbox, date: iso, ...content });
    if (this.rng.chance(dupProb)) {
      // 다른 메일함으로 전달된 사본
      this.emails.push({ id: '', mailbox: mailbox === 'gmail' ? 'naver' : 'gmail', date: iso, ...content });
    }
  }
}

/** 정답 결제 경로: 엔진이 붙이는 이름 규칙(농협은행 계좌, 애플 앱스토어 등)을 따른다. */
function truthPath(t: SubTemplate): string[] {
  if (t.channel === 'pay') {
    const name = PAY_NAME[t.platform!];
    if (t.funding === 'money') return [`${BANK} 계좌`, `${name} 머니`];
    return t.funding === 'account' ? [`${BANK} 계좌`, name] : [CARD, name];
  }
  if (t.channel !== 'card') return [`${BANK} 계좌`];
  const via = matchMerchant(t.merchant).via;
  return via ? [CARD, INTERMEDIARY_BY_ID.get(via)!.name] : [CARD];
}

function runPlan(b: Builder, rng: Rng, plan: Plan, payHistories: boolean): TruthEntry | null {
  const { t } = plan;
  const endIdx = monthIndex(AS_OF);
  const charges: { date: string; krw: number; native: number }[] = [];
  let receipts = 0;
  let nextNominal = '';

  const charge = (nominal: string, next: string) => {
    let actual = nominal;
    if (t.channel === 'bank-cms' || t.channel === 'bank-autodebit') actual = nextBusinessDay(nominal);
    else if (t.maxDelay) actual = addDays(nominal, rng.int(0, t.maxDelay));
    if (plan.noisy && t.channel === 'card' && rng.chance(0.2)) actual = addDays(actual, rng.int(1, 2));
    if (actual > AS_OF) return false;
    const n = charges.length;
    let native = plan.raiseFrom !== undefined && n >= plan.raiseFrom && t.raisedPrice ? t.raisedPrice : t.price;
    if (t.variable) native = Math.round(rng.int(t.variable[0], t.variable[1]) / 10) * 10;
    const krw = t.currency === 'USD' ? Math.round(native * b.fx(actual)) : native;
    const merchant = plan.noisy && t.channel !== 'pay' && rng.chance(0.3) ? `${t.merchant} ${rng.int(10000, 999999)}` : t.merchant;
    if (t.channel === 'pay') b.addPay(t.platform!, actual, merchant, krw, t.funding!);
    else if (t.channel === 'card') {
      b.addCard(actual, merchant, krw, t.currency === 'USD' ? { foreignAmount: native, foreignCurrency: 'USD' } : {});
    } else {
      b.addBank(actual, merchant, krw, 'out', t.channel === 'bank-cms' ? 'CMS' : '자동이체');
    }
    charges.push({ date: actual, krw, native });
    if (t.issuer && rng.chance(plan.receiptProb)) {
      const content = TEMPLATES[t.issuer]({
        kind: 'charge',
        date: actual,
        amount: native,
        currency: t.currency,
        appName: t.appName,
        itemName: t.itemName,
        nextDate: next,
        account: ACCOUNTS[plan.mailbox],
        ref: String(rng.int(1000, 9999)) + '-' + String(rng.int(1000, 9999)),
      });
      if (content) {
        b.addMail(plan.mailbox, actual, content, 0.1);
        receipts++;
      }
    }
    return true;
  };

  if (t.cycle === 'monthly') {
    for (let mi = plan.startMonth; mi <= endIdx; mi++) {
      const nominal = anchoredDate(mi, plan.day);
      if (nominal < WINDOW_START) continue;
      nextNominal = nominal;
      if (nominal > AS_OF) break;
      if (plan.cancelAfter !== undefined && charges.length >= plan.cancelAfter) break;
      if (!charge(nominal, anchoredDate(mi + 1, plan.day))) break;
      nextNominal = anchoredDate(mi + 1, plan.day);
    }
  } else {
    const [, m, d] = plan.renewal!.split('-').map(Number);
    for (const year of [2026, 2027]) {
      const nominal = yearlyDate(year, m, d);
      nextNominal = nominal;
      if (nominal < WINDOW_START) continue;
      if (nominal > AS_OF) break;
      if (!charge(nominal, addYears(nominal, 1))) break;
      nextNominal = addYears(nominal, 1);
    }
    // 갱신 30일 전 안내 메일
    const notice = addDays(nextNominal, -30);
    if (t.issuer && notice >= WINDOW_START && notice <= AS_OF) {
      const content = TEMPLATES[t.issuer]({
        kind: 'upcoming',
        date: notice,
        amount: t.price,
        currency: t.currency,
        itemName: t.itemName,
        nextDate: nextNominal,
        account: ACCOUNTS[plan.mailbox],
        ref: '',
      });
      if (content) {
        b.addMail(plan.mailbox, notice, content);
        receipts++;
      }
    }
  }

  if (charges.length === 0 && receipts === 0) {
    // 기간 안에 흔적이 전혀 없는 구독도 정답에는 넣는다 (찾을 수 없는 경우로 집계)
    if (plan.startMonth > endIdx || anchoredDate(plan.startMonth, plan.day) > AS_OF) return null;
  }
  const canceled = plan.cancelAfter !== undefined && charges.length >= plan.cancelAfter && nextNominal <= AS_OF;
  if (canceled && t.issuer && plan.cancelMail && charges.length > 0) {
    const last = charges[charges.length - 1].date;
    const date = addDays(last, rng.int(2, Math.max(2, Math.min(20, diffDays(last, AS_OF)))));
    const content = TEMPLATES[t.issuer]({
      kind: 'cancel',
      date,
      amount: 0,
      currency: t.currency,
      appName: t.appName,
      itemName: t.itemName,
      nextDate: nextNominal,
      account: ACCOUNTS[plan.mailbox],
      ref: '',
    });
    if (content && date <= AS_OF) b.addMail(plan.mailbox, date, content);
  }

  // 간편결제 이용내역을 올리지 않으면 통장·카드에는 "카카오페이"처럼만 찍힌다.
  // 이때는 메일이 없는 한 어떤 서비스인지 알 수 없고, 머니로 낸 결제는 충전 기록뿐이라 찾을 수 없다.
  let key = t.key;
  let traces = charges.length;
  if (t.channel === 'pay' && !payHistories) {
    if (t.funding === 'money') traces = 0;
    else if (receipts === 0) key = `via:${t.platform}`;
  }
  const last = charges[charges.length - 1];
  return {
    key,
    name: t.name,
    kind: t.kind,
    cycle: t.cycle,
    status: canceled ? 'canceled' : 'active',
    amount: last?.krw ?? (t.currency === 'KRW' ? t.price : undefined),
    foreignAmount: t.currency === 'USD' ? (last?.native ?? t.price) : undefined,
    nextPaymentDate: canceled ? undefined : nextNominal,
    path: truthPath(t),
    charges: charges.length,
    receipts,
    detectable: traces >= 2 || receipts > 0,
  };
}

function addNoise(b: Builder, rng: Rng, mailboxOf: (issuer: Issuer) => Mailbox) {
  const startIdx = monthIndex(WINDOW_START);
  const endIdx = monthIndex(AS_OF);
  const inWindow = (d: string) => d >= WINDOW_START && d <= AS_OF;
  const randomDay = (mi: number) => anchoredDate(mi, rng.int(1, 31));
  const friends = ['김서연', '이도윤', '최하은', '정우진'];

  for (let mi = startIdx; mi <= endIdx; mi++) {
    const days = (n: number, fn: (date: string) => void) => {
      for (let i = 0; i < n; i++) {
        const d = randomDay(mi);
        if (inWindow(d)) fn(d);
      }
    };
    days(rng.int(6, 12), (d) => b.addCard(d, '스타벅스 역삼점', rng.pick([4500, 5000, 5500, 6100, 6300])));
    days(rng.int(8, 15), (d) => b.addCard(d, 'GS25 역삼점', rng.int(12, 150) * 100));
    days(rng.int(3, 7), (d) => b.addCard(d, '배달의민족', rng.int(140, 380) * 100));
    days(rng.int(0, 3), (d) => b.addCard(d, '올리브영 강남점', rng.int(80, 450) * 100));
    days(rng.int(0, 2), (d) => b.addCard(d, '교보문고 광화문점', rng.int(120, 350) * 100));
    days(rng.int(2, 6), (d) => {
      const amount = rng.int(99, 890) * 100;
      b.addCard(d, '쿠팡', amount);
      if (rng.chance(0.4)) b.addMail(mailboxOf('coupang'), d, NOISE.coupangOrder(amount, rng.pick(['삼다수 2L x 12', '키친타월 6롤', '무선 마우스', '단백질 바 20개'])));
    });
    // 네이버페이 쇼핑: 대부분 신한카드, 가끔 농협 계좌로 결제
    days(rng.int(1, 4), (d) => {
      const amount = rng.int(120, 1200) * 100;
      const item = rng.pick(['블루투스 이어폰', '캠핑 의자', '여름 셔츠']);
      b.addPay('naverpay', d, item, amount, rng.chance(0.7) ? 'card' : 'account');
      if (rng.chance(0.5)) b.addMail(mailboxOf('naverpay'), d, NOISE.naverpayOneTime(amount, item, d));
    });
    // 카카오페이: 택시·편의점 결제(계좌 또는 머니)와 친구 송금
    days(rng.int(2, 6), (d) =>
      b.addPay('kakaopay', d, rng.pick(['카카오T 택시', '이마트24 역삼점', '카카오 선물하기', '스타벅스 역삼점']), rng.int(48, 350) * 100, rng.chance(0.6) ? 'account' : 'money'),
    );
    days(rng.int(0, 2), (d) => b.addPay('kakaopay', d, rng.pick(friends), rng.int(1, 10) * 10000, 'account', 'transfer'));
    // 통장: 체크카드, 친구 송금, 급여
    days(rng.int(3, 8), (d) => b.addBank(d, rng.pick(['세븐일레븐 역삼점', '이마트24 역삼점', '김밥천국 역삼점']), rng.int(15, 120) * 100, 'out', '체크카드'));
    days(rng.int(0, 3), (d) => b.addBank(d, rng.pick(friends), rng.int(1, 10) * 10000, 'out', '이체'));
    const payday = nextBusinessDay(anchoredDate(mi, 25));
    if (inWindow(payday)) b.addBank(payday, '(주)테크컴퍼니', 3200000, 'in', '급여');
    const saving = nextBusinessDay(anchoredDate(mi, 1));
    if (inWindow(saving)) b.addBank(saving, '토스뱅크 적금', 300000, 'out', '자동이체');
    const rent = anchoredDate(mi, 25);
    if (inWindow(rent)) b.addBank(rent, '박지훈', 550000, 'out', '이체', '월세');
    if (rng.chance(0.3)) days(1, (d) => b.addBank(d, 'ATM 출금', rng.pick([50000, 100000]), 'out', 'ATM'));
    if (rng.chance(0.5)) days(1, (d) => b.addMail(mailboxOf('netflix'), d, NOISE.netflixNewsletter()));
    if (rng.chance(0.5)) days(1, (d) => b.addMail(rng.pick(['gmail', 'naver'] as const), d, NOISE.shoppingAd()));
  }

  // 함정 1: 한 달 남짓마다 가는 미용실 (같은 금액이지만 날짜가 계속 밀림)
  for (let d = addDays(WINDOW_START, rng.int(0, 20)); d <= AS_OF; d = addDays(d, rng.int(33, 40))) b.addCard(d, '블루클럽 역삼점', 15000);
  // 함정 2: 교통카드 충전 (같은 금액, 불규칙 간격)
  for (let d = addDays(WINDOW_START, rng.int(0, 10)); d <= AS_OF; d = addDays(d, rng.int(8, 20))) b.addCard(d, '티머니 충전', 50000);
  // 함정 3: 우연히 한 달 간격으로 같은 금액 결제
  if (rng.chance(0.35)) {
    const first = anchoredDate(rng.int(startIdx, endIdx - 1), rng.int(1, 28));
    for (const d of [first, addMonths(first, 1)]) if (d <= AS_OF) b.addCard(d, '교보문고 광화문점', 16500);
  }
  // 함정 4: 앱스토어 단건 구매
  if (rng.chance(0.5)) {
    const d = randomDay(rng.int(startIdx, endIdx));
    if (inWindow(d)) {
      b.addCard(d, 'APPLE.COM/BILL', 5500);
      b.addMail(mailboxOf('apple'), d, NOISE.appleOneTime(5500, d, ACCOUNTS[mailboxOf('apple')]));
    }
  }
  // 함정 5: 피싱 메일
  if (rng.chance(0.5)) b.addMail(rng.pick(['gmail', 'naver'] as const), addDays(AS_OF, -rng.int(1, 60)), NOISE.phishing());

  // 카드대금: 전달 카드 사용액이 14일(영업일)에 통장에서 빠져나감
  for (let mi = startIdx; mi <= endIdx; mi++) {
    const date = nextBusinessDay(anchoredDate(mi, 14));
    if (!inWindow(date)) continue;
    const prev = b.card.filter((t) => monthIndex(t.date) === mi - 1).reduce((s, t) => s + t.amount, 0);
    b.addBank(date, CARD, prev || rng.int(700, 1200) * 1000, 'out', '자동이체');
  }
}

function finalize(b: Builder, seed: number, truth: TruthEntry[], payHistories: boolean): SimData {
  const sort = (list: Transaction[]) =>
    list.sort((x, y) => x.date.localeCompare(y.date) || (x.time ?? '').localeCompare(y.time ?? ''));
  sort(b.card).forEach((t, i) => (t.id = `card-${i + 1}`));
  sort(b.bank).forEach((t, i) => (t.id = `bank-${i + 1}`));
  const kakao = sort(b.pay.filter((t) => t.institution === PAY_NAME.kakaopay));
  const naver = sort(b.pay.filter((t) => t.institution === PAY_NAME.naverpay));
  kakao.forEach((t, i) => (t.id = `kakaopay-${i + 1}`));
  naver.forEach((t, i) => (t.id = `naverpay-${i + 1}`));
  b.emails.sort((x, y) => x.date.localeCompare(y.date)).forEach((m, i) => (m.id = `${m.mailbox}-${i + 1}`));
  return {
    seed,
    start: WINDOW_START,
    asOf: AS_OF,
    transactions: [...b.bank, ...b.card, ...(payHistories ? [...kakao, ...naver] : [])],
    emails: b.emails,
    truth,
    payHistories,
    links: payHistories ? b.links.map(([p, s]) => [p.id, s.id]) : [],
  };
}

/** 데모용 고정 사용자: 여러 경우를 한 번에 보여주도록 구성 */
export function generateShowcase(): SimData {
  const rng = createRng(20261027);
  const b = new Builder(rng);
  const start = monthIndex(WINDOW_START) - 1;
  const p = (key: string, day: number, mailbox: Mailbox, extra: Partial<Plan> = {}): Plan => {
    const t = byKey.get(key)!;
    return { t, day, startMonth: start, mailbox, receiptProb: t.receiptProb, cancelMail: true, ...extra };
  };
  const plans: Plan[] = [
    p('netflix', 5, 'gmail', { raiseFrom: 3, receiptProb: 0.5 }),
    p('youtube-premium', 7, 'gmail'),
    p('chatgpt-plus', 9, 'gmail'),
    p('coupang-wow', 12, 'naver'),
    p('naver-plus', 15, 'naver'),
    p('melon', 16, 'gmail'),
    p('emoticon-plus', 6, 'gmail'),
    p('icloud-plus', 3, 'naver'),
    p('duolingo', 18, 'naver'),
    p(appKey('Bear Pro'), 22, 'naver'),
    p('disney-plus', 10, 'gmail', { cancelAfter: 3 }),
    p('millie', 20, 'gmail'),
    p('microsoft-365', 12, 'gmail', { renewal: '2026-06-12' }),
    p('coway', 25, 'naver'),
    p('skt', 21, 'naver'),
    p('m:핏앤짐 역삼점', 1, 'gmail'),
    p('spotify', 2, 'gmail', { startMonth: monthIndex('2026-09-01'), receiptProb: 0 }),
    p('tving', 8, 'naver', { startMonth: monthIndex('2026-10-01'), receiptProb: 0 }),
  ];
  const truth = plans.map((plan) => runPlan(b, rng, plan, true)).filter((t): t is TruthEntry => t !== null);
  const mailboxOf = (issuer: Issuer) => plans.find((pl) => pl.t.issuer === issuer)?.mailbox ?? 'gmail';
  addNoise(b, rng, mailboxOf);
  return finalize(b, 0, truth, true);
}

/** 평가용 무작위 사용자. 4명 중 3명꼴로 간편결제 이용내역도 올린 것으로 친다. */
export function generateRandom(seed: number): SimData {
  const rng = createRng(seed);
  const b = new Builder(rng);
  const startIdx = monthIndex(WINDOW_START);
  const payHistories = rng.chance(0.75);
  const chosen = rng.shuffle(CATALOG).slice(0, rng.int(4, 10));
  const mailboxes = new Map<Issuer, Mailbox>();
  const plans = chosen.map((t): Plan => {
    if (t.issuer && !mailboxes.has(t.issuer)) mailboxes.set(t.issuer, rng.pick(['gmail', 'naver'] as const));
    const startedBefore = rng.chance(0.7);
    return {
      t,
      day: rng.int(1, 31),
      renewal: t.cycle === 'yearly' ? yearlyDate(2026, rng.int(1, 12), rng.int(1, 28)) : undefined,
      startMonth: startedBefore ? startIdx - 1 : startIdx + rng.int(0, 5),
      cancelAfter: rng.chance(0.15) ? rng.int(1, 4) : undefined,
      raiseFrom: t.raisedPrice && rng.chance(0.3) ? rng.int(1, 5) : undefined,
      mailbox: t.issuer ? mailboxes.get(t.issuer)! : 'gmail',
      receiptProb: t.receiptProb,
      cancelMail: rng.chance(0.7),
      noisy: true,
    };
  });
  const truth = plans.map((plan) => runPlan(b, rng, plan, payHistories)).filter((t): t is TruthEntry => t !== null);
  addNoise(b, rng, (issuer) => mailboxes.get(issuer) ?? 'gmail');
  return finalize(b, seed, truth, payHistories);
}
