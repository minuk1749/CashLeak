// 가상 메일 템플릿. 실제 서비스 메일 형식을 그대로 옮긴 것이 아니라 비슷하게 꾸민 것이다.
import type { Currency } from '../src/types.ts';

export type Issuer =
  | 'netflix'
  | 'google'
  | 'openai'
  | 'coupang'
  | 'naverpay'
  | 'apple'
  | 'disney'
  | 'millie'
  | 'microsoft'
  | 'spotify'
  | 'tving'
  | 'baemin'
  | 'skt';

export interface MailContext {
  kind: 'charge' | 'cancel' | 'upcoming';
  date: string;
  amount: number;
  currency: Currency;
  appName?: string;
  itemName: string;
  nextDate?: string;
  account: string;
  ref: string;
}

export interface MailContent {
  from: string;
  subject: string;
  text: string;
}

const [Y, M, D] = [0, 1, 2];
const parts = (date: string) => date.split('-').map(Number);
const koDate = (date = '') => {
  const p = parts(date);
  return `${p[Y]}년 ${p[M]}월 ${p[D]}일`;
};
const dotDate = (date = '') => date.replace(/-/g, '.');
const googleDate = (date = '') => {
  const p = parts(date);
  return `${p[Y]}. ${p[M]}. ${p[D]}.`;
};
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const enDate = (date = '') => {
  const p = parts(date);
  return `${EN_MONTHS[p[M] - 1]} ${p[D]}, ${p[Y]}`;
};
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const wonSign = (n: number) => `₩${n.toLocaleString('ko-KR')}`;
const lines = (...l: string[]) => l.join('\n');

export const TEMPLATES: Record<Issuer, (c: MailContext) => MailContent | null> = {
  netflix: (c) =>
    c.kind === 'charge'
      ? {
          from: 'Netflix <info@account.netflix.com>',
          subject: '넷플릭스 멤버십 결제가 완료되었습니다',
          text: lines('고객님, 안녕하세요.', '넷플릭스 멤버십 요금이 결제되었습니다.', '', `멤버십: ${c.itemName}`, `결제 금액: ${won(c.amount)}`, `결제일: ${koDate(c.date)}`, `다음 결제일: ${koDate(c.nextDate)}`),
        }
      : c.kind === 'cancel'
        ? {
            from: 'Netflix <info@account.netflix.com>',
            subject: '넷플릭스 멤버십이 해지되었습니다',
            text: lines('멤버십 해지가 완료되었습니다.', `${koDate(c.nextDate)}까지 계속 시청하실 수 있습니다.`),
          }
        : null,

  google: (c) =>
    c.kind === 'charge'
      ? {
          from: 'Google Payments <payments-noreply@google.com>',
          subject: `Google 주문 영수증 (${googleDate(c.date)})`,
          text: lines('주문해 주셔서 감사합니다.', `${c.itemName} (월간)`, '판매자: Google LLC', `주문 번호: GPA.${c.ref}`, `결제 금액: ${wonSign(c.amount)}/월`, `다음 결제일: ${googleDate(c.nextDate)}`),
        }
      : c.kind === 'cancel'
        ? {
            from: 'Google Payments <payments-noreply@google.com>',
            subject: '구독이 취소되었습니다',
            text: lines(`${c.itemName} 구독이 취소되었습니다.`, `${googleDate(c.nextDate)}까지 이용할 수 있습니다.`),
          }
        : null,

  openai: (c) =>
    c.kind === 'charge'
      ? {
          from: 'OpenAI <noreply@tm.openai.com>',
          subject: `Your receipt from OpenAI #${c.ref}`,
          text: lines('Receipt from OpenAI', `Receipt #${c.ref}`, `Date paid: ${enDate(c.date)}`, 'Payment method: Visa - 4821', '', `${c.itemName} Subscription  Qty 1  $${c.amount.toFixed(2)}`, `Subtotal  $${c.amount.toFixed(2)}`, `Amount paid  $${c.amount.toFixed(2)}`),
        }
      : c.kind === 'cancel'
        ? {
            from: 'OpenAI <noreply@tm.openai.com>',
            subject: `Your ${c.itemName} subscription has been canceled`,
            text: lines('Your subscription has been canceled.', `You will keep access until ${enDate(c.nextDate)}.`),
          }
        : null,

  coupang: (c) =>
    c.kind === 'charge'
      ? {
          from: '쿠팡 <no-reply@coupang.com>',
          subject: '[쿠팡] 와우 멤버십 월회비 결제 안내',
          text: lines('고객님의 와우 멤버십 월회비가 정상적으로 결제되었습니다.', `결제일: ${dotDate(c.date)}`, `결제금액: ${won(c.amount)}`, '결제수단: 신한카드'),
        }
      : c.kind === 'cancel'
        ? { from: '쿠팡 <no-reply@coupang.com>', subject: '[쿠팡] 와우 멤버십 해지 완료 안내', text: '와우 멤버십 해지가 완료되었습니다.' }
        : null,

  naverpay: (c) =>
    c.kind === 'charge'
      ? {
          from: '네이버페이 <naverpay_noreply@navercorp.com>',
          subject: '[네이버페이] 정기결제가 완료되었습니다',
          text: lines(`${c.itemName} 정기결제 안내`, `결제일시: ${dotDate(c.date)} 10:00`, `결제금액: ${won(c.amount)}`, '결제수단: 신한카드', `다음 결제 예정일: ${dotDate(c.nextDate)}`),
        }
      : c.kind === 'cancel'
        ? { from: '네이버페이 <naverpay_noreply@navercorp.com>', subject: '[네이버페이] 정기결제 해지 안내', text: `${c.itemName} 정기결제가 해지되었습니다.` }
        : null,

  apple: (c) =>
    c.kind === 'charge'
      ? {
          from: 'Apple <no_reply@email.apple.com>',
          subject: 'Apple에서 발송한 영수증입니다',
          text: lines('영수증', `Apple 계정: ${c.account}`, `청구일: ${koDate(c.date)}`, `주문 ID: M${c.ref}`, '', c.appName ?? c.itemName, `${c.itemName} (월간)`, `갱신일: ${koDate(c.nextDate)}`, wonSign(c.amount), '', `합계 ${wonSign(c.amount)}`),
        }
      : c.kind === 'cancel'
        ? {
            from: 'Apple <no_reply@email.apple.com>',
            subject: 'Apple 구독 해지 확인',
            text: lines(`${c.itemName} (월간) 구독이 해지되었습니다.`, `${koDate(c.nextDate)}까지 이용할 수 있습니다.`),
          }
        : null,

  disney: (c) =>
    c.kind === 'charge'
      ? {
          from: 'Disney+ <disneyplus@mail.disneyplus.com>',
          subject: '디즈니+ 결제 영수증',
          text: lines(`${c.itemName} (월간 구독)`, `결제일: ${koDate(c.date)}`, `결제 금액: ${won(c.amount)}`, `다음 결제일: ${koDate(c.nextDate)}`),
        }
      : c.kind === 'cancel'
        ? {
            from: 'Disney+ <disneyplus@mail.disneyplus.com>',
            subject: '디즈니+ 구독이 해지되었습니다',
            text: lines('구독 해지가 완료되었습니다.', `${koDate(c.nextDate)}까지 이용 가능합니다.`),
          }
        : null,

  millie: (c) =>
    c.kind === 'charge'
      ? {
          from: '밀리의 서재 <help@millie.co.kr>',
          subject: '[밀리의 서재] 정기결제 완료 안내',
          text: lines('월 정기구독 이용권 결제가 완료되었습니다.', `결제일: ${c.date}`, `결제금액: ${won(c.amount)}`, `다음 결제일: ${c.nextDate}`),
        }
      : c.kind === 'cancel'
        ? { from: '밀리의 서재 <help@millie.co.kr>', subject: '[밀리의 서재] 정기구독 해지 완료', text: '정기구독 해지가 완료되었습니다.' }
        : null,

  microsoft: (c) =>
    c.kind === 'charge'
      ? {
          from: 'Microsoft <microsoft-noreply@microsoft.com>',
          subject: `${c.itemName} 구독이 갱신되었습니다`,
          text: lines(`${c.itemName} (연간)`, `결제일: ${koDate(c.date)}`, `금액: ${wonSign(c.amount)}`, `다음 청구일: ${koDate(c.nextDate)}`),
        }
      : c.kind === 'upcoming'
        ? {
            from: 'Microsoft <microsoft-noreply@microsoft.com>',
            subject: `${c.itemName} 구독이 곧 갱신됩니다`,
            text: lines(`${c.itemName} (연간)`, `${koDate(c.nextDate)}에 ${wonSign(c.amount)}으로 자동 갱신됩니다.`),
          }
        : null,

  spotify: (c) =>
    c.kind === 'charge'
      ? {
          from: 'Spotify <no-reply@spotify.com>',
          subject: 'Spotify Premium 영수증',
          text: lines(`${c.itemName} (월간)`, `결제일: ${dotDate(c.date)}`, `결제 금액: ${won(c.amount)}`, `다음 결제일: ${dotDate(c.nextDate)}`),
        }
      : c.kind === 'cancel'
        ? { from: 'Spotify <no-reply@spotify.com>', subject: 'Spotify Premium 해지 확인', text: 'Premium 구독이 해지되었습니다.' }
        : null,

  tving: (c) =>
    c.kind === 'charge'
      ? {
          from: 'TVING <noreply@tving.com>',
          subject: '[티빙] 이용권 결제 완료',
          text: lines(`${c.itemName} 이용권 (매월 자동결제)`, `결제금액: ${won(c.amount)}`, `다음 결제일: ${dotDate(c.nextDate)}`),
        }
      : c.kind === 'cancel'
        ? { from: 'TVING <noreply@tving.com>', subject: '[티빙] 이용권 해지 완료', text: '이용권 해지가 완료되었습니다.' }
        : null,

  baemin: (c) =>
    c.kind === 'charge'
      ? {
          from: '배민 <noreply@woowahan.com>',
          subject: '[배민클럽] 멤버십 요금 결제 안내',
          text: lines(`배민클럽 월 이용료 ${won(c.amount)}이 결제되었습니다.`, `다음 결제일: ${dotDate(c.nextDate)}`),
        }
      : c.kind === 'cancel'
        ? { from: '배민 <noreply@woowahan.com>', subject: '[배민클럽] 멤버십 해지 완료', text: '배민클럽 해지가 완료되었습니다.' }
        : null,

  skt: (c) => {
    if (c.kind !== 'charge') return null;
    const month = parts(c.date)[M];
    return {
      from: 'SK텔레콤 <billing@sktelecom.com>',
      subject: `[SK텔레콤] ${month}월 이용요금 자동이체 안내`,
      text: lines(`고객님의 ${month}월 이용요금이 등록하신 계좌에서 자동이체로 출금되었습니다.`, `출금일: ${dotDate(c.date)}`, `출금금액: ${won(c.amount)}`),
    };
  },
};

// 구독이 아닌 메일 (탐지되면 안 되는 것들)
export const NOISE = {
  coupangOrder: (amount: number, item: string): MailContent => ({
    from: '쿠팡 <no-reply@coupang.com>',
    subject: '[쿠팡] 주문하신 상품의 결제가 완료되었습니다',
    text: lines(`상품: ${item}`, '와우 멤버십 회원 무료배송이 적용되었습니다.', `상품금액: ${won(amount)}`, '배송비: 0원', `결제금액: ${won(amount)}`),
  }),
  naverpayOneTime: (amount: number, item: string, date: string): MailContent => ({
    from: '네이버페이 <naverpay_noreply@navercorp.com>',
    subject: '[네이버페이] 결제가 완료되었습니다',
    text: lines(`상품명: ${item}`, `결제일시: ${dotDate(date)} 14:22`, `결제금액: ${won(amount)}`),
  }),
  appleOneTime: (amount: number, date: string, account: string): MailContent => ({
    from: 'Apple <no_reply@email.apple.com>',
    subject: 'Apple에서 발송한 영수증입니다',
    text: lines('영수증', `Apple 계정: ${account}`, `청구일: ${koDate(date)}`, '', '브롤스타즈', '보석 30개', wonSign(amount), '', `합계 ${wonSign(amount)}`),
  }),
  netflixNewsletter: (): MailContent => ({
    from: 'Netflix <info@mailer.netflix.com>',
    subject: '이번 주 넷플릭스 신작을 확인하세요',
    text: '새로운 시리즈가 공개되었습니다. 지금 시청하세요.',
  }),
  phishing: (): MailContent => ({
    from: 'Netflix 고객센터 <billing@netflix-account-help.com>',
    subject: '[Netflix] 결제 실패 - 멤버십이 곧 정지됩니다',
    text: lines('결제 정보를 업데이트해 주세요.', '미납 금액: 17,000원'),
  }),
  shoppingAd: (): MailContent => ({
    from: '무신사 <news@musinsa.com>',
    subject: '[광고] 이번 주 회원 전용 특가',
    text: lines('최대 70% 할인', '쿠폰 5,000원 즉시 지급'),
  }),
};
