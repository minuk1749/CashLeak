import type { Currency, Cycle, EmailMessage, EmailReceipt, Intermediary, ReceiptType } from '../types.ts';
import { appKey, INTERMEDIARIES, SERVICES } from '../merchants.ts';
import { diffDays, kstDate, yearlyDate } from '../dates.ts';

// 규칙 기반 파서. 실제 메일은 형식이 제각각이라 이후 단계에서 LLM 파서로 보완할 예정이고,
// 그때도 이 결과 형태(EmailReceipt)는 그대로 쓴다.

/** 구독·정기결제임을 나타내는 표현 */
const HINT = /구독|정기|멤버십|갱신|월간|연간|매월|매년|이용권|청구서|자동이체|월 ?회비|월 ?이용료|subscription|renew|membership|monthly|annual|yearly/i;
const NEGATIVE = /실패|정지|중단 예정|업데이트(가)? 필요|확인(이)? 필요|failed|declined|suspend|update your payment/i;
const CANCEL = /(해지|취소)\s*(가|이)?\s*(완료|되었|처리)|해지 확인|cancel(l)?ed|cancellation/i;
const UPCOMING = /(갱신|결제)\s*예정 안내|곧\s*(갱신|결제)|will (renew|be charged)|upcoming (renewal|payment)/i;
const CHARGE = /(결제|청구|갱신|출금)\s*(가|이)?\s*(완료|되었)|영수증|청구서|자동이체 안내|receipt|renewed|payment (received|successful)/i;
const TOTAL = /합계|총액|총\s*결제|(결제|청구|이용|출금|납부)\s*금액|Total|Amount (paid|charged)|금액/i;
const KRW = /(?:₩|KRW)\s?(\d[\d,]*)|(\d[\d,]*)\s?원/;
const USD = /(?:\$|USD)\s?(\d[\d,]*(?:\.\d{1,2})?)/;
const YEARLY = /연간|매년|(?<!\d)1년|annual|yearly|per year|\/\s?년/i;
const MONTHLY = /월간|매월|1개월|월 ?회비|월 ?이용료|월 ?정기|monthly|per month|\/\s?월/i;
const NEXT_LABEL = /(다음|차기)\s*(결제|갱신|청구)\s*(예정)?\s*일|갱신일|renews on|next (billing|payment)/i;
const KO_DATE = /(\d{4})\s*[년.\-/]\s*(\d{1,2})\s*[월.\-/]\s*(\d{1,2})/;
const EN_DATE = /([A-Z][a-z]{2,8})\.? (\d{1,2}), (\d{4})/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const ITEM_LABEL = /^(?:상품명|항목|구독 상품|Item|Product)\s*[:：]\s*(.+)$/i;
const ITEM_PERIOD = /^(.+?)\s*\((?:월간|연간|매월|매년|1개월|1년|Monthly|Annual|Yearly)\)/i;

interface Identity {
  serviceId: string;
  serviceName: string;
  via?: Intermediary;
  generic?: boolean;
  /** 중개자 영수증에서 서비스명·상품명이 나온 줄 */
  nameLines: string[];
}

function senderDomain(from: string): string {
  return from.match(/@([A-Za-z0-9.-]+)/)?.[1].toLowerCase() ?? '';
}

function senderName(from: string): string {
  return from.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
}

const domainMatches = (domain: string, list: string[]) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

function identify(msg: EmailMessage, lines: string[]): Identity | null {
  const domain = senderDomain(msg.from);
  const direct = SERVICES.find((s) => domainMatches(domain, s.senders));
  if (direct) return { serviceId: direct.id, serviceName: direct.name, nameLines: [] };
  const via = INTERMEDIARIES.find((i) => domainMatches(domain, i.senders));
  if (via) {
    // 중개자 영수증: 본문에서 서비스명을 찾고, 없으면 상품명 줄을 쓴다.
    for (const s of SERVICES) {
      const nameLines = lines.filter((l) => s.names.some((p) => p.test(l)));
      if (nameLines.length) return { serviceId: s.id, serviceName: s.name, via: via.id, nameLines };
    }
    for (const line of lines) {
      const item = line.match(ITEM_LABEL)?.[1] ?? line.match(ITEM_PERIOD)?.[1];
      if (item) return { serviceId: appKey(item.trim()), serviceName: item.trim(), via: via.id, nameLines: [line] };
    }
    return null;
  }
  if (!domain) return null;
  const name = senderName(msg.from) || domain;
  return { serviceId: `mail:${domain}`, serviceName: name, generic: true, nameLines: [] };
}

function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

function findAmount(lines: string[]): { amount: number; currency: Currency } | null {
  const scan = (candidates: string[]) => {
    for (const line of candidates) {
      const usd = line.match(USD);
      if (usd) return { amount: parseNumber(usd[1]), currency: 'USD' as const };
      const krw = line.match(KRW);
      if (krw) return { amount: parseNumber(krw[1] ?? krw[2]), currency: 'KRW' as const };
    }
    return null;
  };
  return scan(lines.filter((l) => TOTAL.test(l))) ?? scan(lines);
}

function parseDate(text: string): string | undefined {
  const ko = text.match(KO_DATE);
  if (ko) return yearlyDate(Number(ko[1]), Number(ko[2]), Number(ko[3]));
  const en = text.match(EN_DATE);
  if (en) {
    const month = MONTHS.indexOf(en[1].slice(0, 3).toLowerCase());
    if (month >= 0) return yearlyDate(Number(en[3]), month + 1, Number(en[2]));
  }
  return undefined;
}

function findNextDate(lines: string[], type: ReceiptType, subject: string): string | undefined {
  for (const line of lines) {
    if (NEXT_LABEL.test(line)) {
      const d = parseDate(line);
      if (d) return d;
    }
  }
  if (type === 'upcoming') {
    for (const line of [subject, ...lines]) {
      if (/갱신|결제|renew|charge/i.test(line)) {
        const d = parseDate(line);
        if (d) return d;
      }
    }
  }
  return undefined;
}

function classifyType(subject: string, text: string): ReceiptType | null {
  if (CANCEL.test(subject)) return 'cancel';
  if (UPCOMING.test(subject)) return 'upcoming';
  if (CHARGE.test(subject)) return 'charge';
  if (CANCEL.test(text)) return 'cancel';
  if (CHARGE.test(text)) return 'charge';
  if (UPCOMING.test(text)) return 'upcoming';
  return null;
}

export function parseEmail(msg: EmailMessage): EmailReceipt | null {
  if (NEGATIVE.test(msg.subject)) return null;
  const lines = msg.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const who = identify(msg, lines);
  if (!who) return null;
  const type = classifyType(msg.subject, msg.text);
  if (!type) return null;

  const amountLines = lines.filter((l) => KRW.test(l) || USD.test(l));
  // 일반 주문 영수증과 구분하려면 제목, 금액 줄, 상품명 줄, 갱신일 중 하나에 구독 표현이 있어야 한다.
  const subscriptionLike = who.generic
    ? HINT.test(msg.subject)
    : HINT.test(msg.subject) ||
      amountLines.some((l) => HINT.test(l)) ||
      who.nameLines.some((l) => HINT.test(l)) ||
      lines.some((l) => NEXT_LABEL.test(l));
  if (!subscriptionLike) return null;

  const found = findAmount(lines);
  if (type === 'charge' && !found) return null;
  const all = `${msg.subject}\n${msg.text}`;
  const cycle: Cycle | undefined = YEARLY.test(all) ? 'yearly' : MONTHLY.test(all) ? 'monthly' : undefined;
  return {
    emailId: msg.id,
    mailbox: msg.mailbox,
    type,
    serviceId: who.serviceId,
    serviceName: who.serviceName,
    date: kstDate(msg.date),
    amount: found?.amount,
    currency: found?.currency,
    cycle,
    nextDate: findNextDate(lines, type, msg.subject),
    billedVia: who.via,
  };
}

/** Gmail과 네이버메일에 같은 영수증이 들어온 경우(전달, 외부메일 가져오기) 하나만 남긴다. */
export function markDuplicates(receipts: EmailReceipt[]): EmailReceipt[] {
  const sorted = [...receipts].sort((a, b) => a.date.localeCompare(b.date) || a.emailId.localeCompare(b.emailId));
  const kept: EmailReceipt[] = [];
  return sorted.map((r) => {
    const original = kept.find(
      (k) =>
        k.serviceId === r.serviceId &&
        k.type === r.type &&
        k.amount === r.amount &&
        k.currency === r.currency &&
        Math.abs(diffDays(k.date, r.date)) <= 1,
    );
    if (original) return { ...r, duplicateOf: original.emailId };
    kept.push(r);
    return r;
  });
}

export function parseEmails(messages: EmailMessage[]): EmailReceipt[] {
  return markDuplicates(messages.map(parseEmail).filter((r): r is EmailReceipt => r !== null));
}
