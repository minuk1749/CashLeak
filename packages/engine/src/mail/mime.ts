import PostalMime, { type Address } from 'postal-mime';
import type { EmailMessage, Mailbox } from '../types.ts';
import { htmlToText, tidyLines } from '../email/html-text.ts';

/** 메일 한 통에서 남기는 본문 길이. 금액·서비스명·날짜는 앞부분에 있고, 기기 저장 공간을 아껴야 한다. */
export const MAX_TEXT_LENGTH = 4000;

function formatAddress(address: Address | undefined): string {
  if (!address) return '';
  const box = address.group ? address.group[0] : address;
  if (!box) return address.name;
  return box.name ? `${box.name} <${box.address}>` : box.address;
}

function validIso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

/** 링크 주소는 길기만 하고 판별에 쓰이지 않아서 뺀다. */
const withoutLinks = (text: string) => tidyLines(text.replace(/<?\bhttps?:\/\/[^\s>]+>?/g, ''));

/**
 * 본문 글자. 글자 본문(text/plain)과 HTML 본문 중 내용이 더 많은 쪽을 쓴다.
 * 글자 본문이 'HTML을 볼 수 있는 프로그램에서 열어 주세요' 같은 안내뿐인 메일이 있고, 반대로 HTML 쪽이 짧은 메일도 있다.
 */
function bodyText(text: string | undefined, html: string | undefined): string {
  const plain = withoutLinks(text ?? '');
  const fromHtml = html ? withoutLinks(htmlToText(html)) : '';
  return (fromHtml.length > plain.length ? fromHtml : plain).slice(0, MAX_TEXT_LENGTH);
}

/** 메일 원문(RFC 822)을 탐지 엔진이 읽는 메일로 바꾼다. */
export async function readRawEmail(
  raw: Uint8Array | string,
  meta: { id: string; mailbox: Mailbox; receivedAt?: Date | string },
): Promise<EmailMessage> {
  const email = await PostalMime.parse(raw);
  return {
    id: meta.id,
    mailbox: meta.mailbox,
    from: formatAddress(email.from),
    subject: (email.subject ?? '').replace(/\s+/g, ' ').trim(),
    // 보낸 시각이 없거나 잘못됐으면 받은 시각을 쓴다.
    date: validIso(email.date) ?? validIso(meta.receivedAt) ?? new Date(0).toISOString(),
    text: bodyText(email.text, email.html),
  };
}
