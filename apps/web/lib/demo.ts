import { bankCsv, cardCsv, generateShowcase, PAY_NAME, payCsv } from '@cashleak/engine/sim';
import type { FileInput } from './files.ts';

/**
 * 체험용 가상 사용자의 내역 파일: 농협 통장, 신한카드, 카카오페이, 네이버페이, Gmail, 네이버메일.
 * 실제 파일을 올릴 때와 같은 경로(파일 → 가져오기 → 탐지)로 처리한다.
 */
export function sampleFiles(): FileInput[] {
  const data = generateShowcase();
  const txs = data.transactions;
  const mails = (mailbox: 'gmail' | 'naver') => JSON.stringify(data.emails.filter((m) => m.mailbox === mailbox), null, 2);
  return [
    { name: 'nh-bank.csv', kind: 'bank', institution: '농협은행', text: bankCsv(txs.filter((t) => t.source === 'bank')) },
    { name: 'shinhan-card.csv', kind: 'card', institution: '신한카드', text: cardCsv(txs.filter((t) => t.source === 'card')) },
    { name: 'kakaopay.csv', kind: 'pay', institution: '카카오페이', text: payCsv(txs.filter((t) => t.institution === PAY_NAME.kakaopay)) },
    { name: 'naverpay.csv', kind: 'pay', institution: '네이버페이', text: payCsv(txs.filter((t) => t.institution === PAY_NAME.naverpay)) },
    { name: 'emails-gmail.json', kind: 'email', institution: 'Gmail', text: mails('gmail') },
    { name: 'emails-naver.json', kind: 'email', institution: '네이버메일', text: mails('naver') },
  ];
}
