import { SERVICES } from '../merchants.ts';
import { couldBeReceipt, senderKind } from '../email/parse.ts';

// 메일함에서 본문을 받을 메일을 고르는 거름망. 제목과 보낸 곳만 보고 고르고,
// 구독 영수증인지는 본문을 받은 뒤 parseEmail이 판단한다.

/** 영수증·결제·구독 안내에 쓰이는 말 */
const SUBJECT = /영수증|결제|구독|갱신|청구|정기|멤버십|이용권|자동이체|요금|해지|환불|주문|구매|receipt|invoice|subscription|renew|payment|billing|membership|order|purchase|cancel/i;
/** 정보통신망법에 따라 광고 메일은 제목 앞에 (광고)를 붙인다. */
const AD = /^\s*[(\[［【]\s*광고\s*[)\]］】]/;

const SERVICE_DOMAINS = SERVICES.flatMap((s) => s.senders);

export function isAdvertisement(subject: string): boolean {
  return AD.test(subject);
}

/**
 * 제목과 보낸 곳으로 보아 구독 영수증일 수 있는 메일인지.
 * - 알려진 서비스가 보낸 메일: 모두 고른다 (제목에 결제 표현이 없는 영수증도 있다).
 * - 앱스토어·간편결제(중개자): 알림 메일이 많아서 제목에 영수증·결제 표현이 있는 것만 고른다.
 * - 그 밖의 곳: 제목에 구독 표현이 있는 것만 고른다 (couldBeReceipt). 쇼핑몰 주문 영수증은 여기서 빠진다.
 */
export function mightBeReceipt(from: string, subject: string): boolean {
  if (isAdvertisement(subject) || !couldBeReceipt(from, subject)) return false;
  return senderKind(from) !== 'intermediary' || SUBJECT.test(subject);
}

/** Gmail 검색어: 기간 안의 메일 중 Gmail이 영수증으로 분류했거나, 제목·보낸 곳이 영수증 같은 것 */
export function gmailQuery(since: string): string {
  const words = ['영수증', '결제', '구독', '갱신', '청구', '정기', '멤버십', '이용권', '자동이체', '요금', '해지', '환불', 'receipt', 'invoice', 'subscription', 'renew', 'payment', 'billing', 'membership'];
  return `after:${since.replaceAll('-', '/')} (label:^smartlabel_receipt OR subject:(${words.join(' OR ')}) OR from:(${SERVICE_DOMAINS.join(' OR ')}))`;
}
