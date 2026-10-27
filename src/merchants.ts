import type { Intermediary, Transaction } from './types.ts';

export interface ServiceInfo {
  id: string;
  name: string;
  category: string;
  kind: 'subscription' | 'bill';
  /** 카드·은행 내역의 가맹점명 (정규화된 대문자 기준) */
  merchants: RegExp[];
  /** 메일 본문에 나오는 서비스명 */
  names: RegExp[];
  /** 이 서비스만 쓰는 발신 도메인 */
  senders: string[];
}

// 알려진 구독 서비스 목록. 실제 데이터를 받으면서 계속 늘려야 한다.
export const SERVICES: ServiceInfo[] = [
  { id: 'netflix', name: '넷플릭스', category: 'OTT', kind: 'subscription', merchants: [/NETFLIX/, /넷플릭스/], names: [/넷플릭스|Netflix/i], senders: ['netflix.com'] },
  { id: 'youtube-premium', name: '유튜브 프리미엄', category: 'OTT', kind: 'subscription', merchants: [/YOUTUBE ?PREMIUM/, /유튜브 ?프리미엄/], names: [/YouTube Premium|유튜브 프리미엄/i], senders: ['youtube.com'] },
  { id: 'google-one', name: 'Google One', category: '클라우드', kind: 'subscription', merchants: [/GOOGLE ?ONE/, /구글 ?원/], names: [/Google One/i], senders: [] },
  { id: 'chatgpt-plus', name: 'ChatGPT Plus', category: 'AI', kind: 'subscription', merchants: [/OPENAI/, /CHATGPT/], names: [/ChatGPT Plus/i], senders: ['openai.com'] },
  { id: 'coupang-wow', name: '쿠팡 와우 멤버십', category: '쇼핑 멤버십', kind: 'subscription', merchants: [/쿠팡.*와우/, /COUPANG.*WOW/], names: [/와우 ?멤버십/], senders: ['coupang.com'] },
  { id: 'naver-plus', name: '네이버플러스 멤버십', category: '쇼핑 멤버십', kind: 'subscription', merchants: [/네이버 ?플러스/], names: [/네이버 ?플러스 ?멤버십/], senders: [] },
  { id: 'icloud-plus', name: 'iCloud+', category: '클라우드', kind: 'subscription', merchants: [], names: [/iCloud\+/], senders: [] },
  { id: 'duolingo', name: '듀오링고 슈퍼', category: '교육', kind: 'subscription', merchants: [/DUOLINGO/, /듀오링고/], names: [/Duolingo|듀오링고/i], senders: ['duolingo.com'] },
  { id: 'disney-plus', name: '디즈니+', category: 'OTT', kind: 'subscription', merchants: [/디즈니 ?플러스/, /DISNEY ?PLUS/], names: [/디즈니\+|디즈니 ?플러스|Disney\+/i], senders: ['disneyplus.com'] },
  { id: 'millie', name: '밀리의 서재', category: '도서', kind: 'subscription', merchants: [/밀리의 ?서재/], names: [/밀리의 ?서재/], senders: ['millie.co.kr'] },
  { id: 'microsoft-365', name: 'Microsoft 365', category: '소프트웨어', kind: 'subscription', merchants: [/MICROSOFT/, /마이크로소프트/], names: [/Microsoft 365/i], senders: ['microsoft.com'] },
  { id: 'spotify', name: '스포티파이', category: '음악', kind: 'subscription', merchants: [/SPOTIFY/, /스포티파이/], names: [/Spotify|스포티파이/i], senders: ['spotify.com'] },
  { id: 'tving', name: '티빙', category: 'OTT', kind: 'subscription', merchants: [/티빙/, /TVING/], names: [/티빙|TVING/i], senders: ['tving.com'] },
  { id: 'baemin-club', name: '배민클럽', category: '배달 멤버십', kind: 'subscription', merchants: [/배민 ?클럽/], names: [/배민 ?클럽/], senders: ['woowahan.com'] },
  { id: 'coway', name: '코웨이 렌탈', category: '렌탈', kind: 'subscription', merchants: [/코웨이/, /COWAY/], names: [/코웨이/], senders: ['coway.com'] },
  { id: 'skt', name: 'SK텔레콤 통신요금', category: '통신', kind: 'bill', merchants: [/SKT/, /SK ?텔레콤/, /에스케이텔레콤/], names: [/SK ?텔레콤/], senders: ['sktelecom.com'] },
];

export const SERVICE_BY_ID = new Map(SERVICES.map((s) => [s.id, s]));

export interface IntermediaryInfo {
  id: Intermediary;
  name: string;
  merchants: RegExp[];
  senders: string[];
}

// 여러 서비스가 같은 이름으로 찍히는 결제 중개자. 어떤 서비스인지는 금액과 메일로 가려낸다.
export const INTERMEDIARIES: IntermediaryInfo[] = [
  { id: 'apple', name: '애플 앱스토어', merchants: [/APPLE\.COM/, /APPLE COM BILL/, /ITUNES/, /애플코리아/], senders: ['apple.com'] },
  { id: 'google', name: '구글 플레이', merchants: [/GOOGLE/, /구글/], senders: ['google.com'] },
  { id: 'naverpay', name: '네이버페이', merchants: [/네이버 ?페이/, /NAVER ?PAY/, /네이버파이낸셜/], senders: ['navercorp.com', 'naver.com'] },
  { id: 'pg', name: '결제대행사', merchants: [/이니시스/, /INICIS/, /토스페이먼츠/, /TOSS ?PAYMENTS/, /KCP/, /나이스페이/, /NICE ?PAY/, /다날/, /DANAL/, /모빌리언스/], senders: [] },
];

export const INTERMEDIARY_BY_ID = new Map(INTERMEDIARIES.map((i) => [i.id, i]));

/** 가맹점명을 비교하기 좋게 정리한다: 대문자, 법인 표기와 긴 숫자(승인번호 등) 제거 */
export function canonicalize(raw: string): string {
  return raw
    .normalize('NFKC')
    .toUpperCase()
    .replace(/\(주\)|㈜|주식회사|\bCO\.?,?\s*LTD\.?|\bINC\.?|\bCORP\.?/g, ' ')
    .replace(/\d{4,}/g, ' ')
    .replace(/[^0-9A-Z가-힣+./]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface MerchantMatch {
  key: string;
  serviceId?: string;
  via?: Intermediary;
}

export function matchMerchant(raw: string): MerchantMatch {
  const text = canonicalize(raw);
  for (const s of SERVICES) {
    if (s.merchants.some((p) => p.test(text))) return { key: `svc:${s.id}`, serviceId: s.id };
  }
  for (const i of INTERMEDIARIES) {
    if (i.merchants.some((p) => p.test(text))) return { key: `via:${i.id}`, via: i.id };
  }
  return { key: `m:${text}` };
}

/** 카탈로그에 없는 앱(앱스토어 영수증의 상품명 등)에 붙이는 키 */
export function appKey(name: string): string {
  const slug = name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]+/g, '-')
    .replace(/^-|-$/g, '');
  return `app:${slug}`;
}

const CARD_BILL = /(신한|삼성|현대|국민|KB|롯데|하나|우리|비씨|BC|농협|NH|씨티|토스|카카오뱅크) ?카드|카드 ?대금/;
const SAVINGS = /적금|예금|청약|저축|증권|투자|내 ?계좌|본인 ?계좌/;
const BILL = /한국전력|한전|도시가스|가스공사|수도요금|관리비|보험|생명|화재|손해|건강보험|국민연금|LG ?U\+|유플러스|알뜰폰|\bKT\b/;
const CASH = /ATM|현금 ?인출|CD ?출금/;
const PERSON = /^[가-힣]{2,4}$/;

/** 구독 후보에서 아예 빼야 하는 출금이면 그 이유를 돌려준다. */
export function exclusionReason(tx: Transaction): string | undefined {
  if (tx.source !== 'bank') return undefined;
  const text = canonicalize(`${tx.merchant} ${tx.memo ?? ''}`);
  if (tx.method === '카드대금' || CARD_BILL.test(text)) return '카드대금 (카드 내역에서 개별 결제로 확인)';
  if (SAVINGS.test(text)) return '저축·투자 이체';
  if (tx.method === 'ATM' || CASH.test(text)) return '현금 인출';
  return undefined;
}

export function looksLikePersonalTransfer(tx: Transaction): boolean {
  return tx.source === 'bank' && tx.method === '이체' && PERSON.test(tx.merchant.trim());
}

export function isBillMerchant(raw: string): boolean {
  return BILL.test(canonicalize(raw));
}
