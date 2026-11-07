import { decodeEntities } from '../io/html-table.ts';

// 영수증 메일은 대부분 HTML로만 온다. 파서(parse.ts)는 줄 단위로 읽으므로
// 문단·표의 줄은 줄바꿈으로, 같은 줄의 칸은 빈칸으로 바꿔 '결제 금액 13,500원'처럼 한 줄에 모이게 한다.

/** 줄을 나누는 태그 (여는 태그와 닫는 태그 모두) */
const BLOCK = /<\/?(?:p|div|tr|li|ul|ol|h[1-6]|table|tbody|thead|tfoot|blockquote|section|article|header|footer|center|dd|dt)\b[^>]*>/gi;
/** 보이지 않는 글자 (메일 미리보기 문구를 숨기는 데 쓰인다) */
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤ㅤ﻿ﾠ]/g;

/** HTML 메일 본문을 줄 단위 글자로 바꾼다. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  return tidyLines(decodeEntities(text));
}

/** 줄마다 공백을 하나로 줄이고 빈 줄과 보이지 않는 글자를 뺀다. */
export function tidyLines(text: string): string {
  return text
    .replace(INVISIBLE, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
