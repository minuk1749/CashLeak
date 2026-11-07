import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeHtmlTable, readHtmlTable } from '../src/io/html-table.ts';
import { decodeText } from '../src/io/text.ts';

test('HTML 표를 엑셀처럼 펼친다: 표는 차례로 잇고, 합친 칸은 첫 칸에만 값을 둔다', () => {
  const html = `<html><head><title>무시</title><style>td { color: red }</style></head><body>
<!-- <table><tr><td>주석 속 표</td></tr></table> -->
<table><tr><td colspan="3">제목</td></tr></table>
<p>표 밖의 글자</p>
<table border=1>
  <tr><th rowspan=2>구분</th><th colspan=2>금액</th></tr>
  <tr><th>출금</th><th>입금</th></tr>
  <tr><td>A&amp;B<br/>마트</td><td>1,000</td><td></td></tr>
  <tr><td>&#54620;글　공백&nbsp;</td><td>&lt;없음&gt;</td></tr>
</table></body></html>`;
  assert.equal(looksLikeHtmlTable(html), true);
  assert.deepEqual(readHtmlTable(html), [
    ['제목'],
    ['구분', '금액'],
    ['', '출금', '입금'],
    ['A&B 마트', '1,000'],
    ['한글 공백', '<없음>'],
  ]);
});

test('표가 없는 HTML과 CSV는 HTML 표로 보지 않는다', () => {
  assert.equal(looksLikeHtmlTable('거래일시,금액\n2026-10-01,1000\n'), false);
  assert.equal(looksLikeHtmlTable('<html><body>조회된 내역이 없습니다.</body></html>'), false);
});

test('글자 파일은 UTF-8로 읽고, 안 되면 EUC-KR로 읽는다', () => {
  // "농협은행,카카오페이"를 EUC-KR로 저장한 바이트
  const euckr = new Uint8Array([179, 243, 199, 249, 192, 186, 199, 224, 44, 196, 171, 196, 171, 191, 192, 198, 228, 192, 204]);
  assert.equal(decodeText(euckr), '농협은행,카카오페이');
  assert.equal(decodeText(euckr.buffer), '농협은행,카카오페이');
  assert.equal(decodeText(new TextEncoder().encode('﻿거래일시')), '거래일시');
  // EUC-KR로 저장한 HTML 표
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  const html = new Uint8Array([...ascii('<table><tr><td>'), ...euckr.slice(0, 8), ...ascii('</td></tr></table>')]);
  assert.deepEqual(readHtmlTable(decodeText(html)), [['농협은행']]);
});
