import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeText, guessFile, openFile, parseFile } from './files.ts';

test('UTF-8로 안 읽히는 파일은 EUC-KR로 읽는다', () => {
  // "농협은행,카카오페이"를 EUC-KR로 저장한 바이트
  const euckr = new Uint8Array([179, 243, 199, 249, 192, 186, 199, 224, 44, 196, 171, 196, 171, 191, 192, 198, 228, 192, 204]);
  assert.equal(decodeText(euckr.buffer), '농협은행,카카오페이');
  assert.equal(decodeText(new TextEncoder().encode('﻿거래일시').buffer as ArrayBuffer), '거래일시');
});

test('파일 이름과 머리글로 종류와 기관을 추측하고, 못 읽는 형식은 이유를 알려 준다', () => {
  assert.deepEqual(guessFile('NH_거래내역.csv', '거래일시,구분,내용,거래금액,거래후잔액\n'), { kind: 'bank', institution: '농협은행' });
  assert.deepEqual(guessFile('kakaopay.csv', '거래일시,구분,거래처,금액,결제수단\n'), { kind: 'pay', institution: '카카오페이' });
  assert.equal(guessFile('내역.pdf', '').kind, null);
  assert.match(guessFile('내역.pdf', '').problem!, /PDF/);
  assert.equal(guessFile('mail.json', '[{"mailbox":"naver","from":"a","subject":"b","date":"2026-10-01T00:00:00+09:00","text":"c"}]').institution, '네이버메일');
  assert.match(guessFile('x.csv', '이름,나이\n').problem!, /종류/);
});

const csv = [
  '거래일시,구분,거래처,금액,결제수단,상태',
  '2026-10-06 08:00:00,결제,스타벅스 역삼점,"-4,500",카카오페이머니,완료',
  '2026-10-06 08:00:00,결제,스타벅스 역삼점,"-4,500",카카오페이머니,완료',
  '2026-10-16 12:00:00,결제,멜론,"-10,900",농협 계좌,완료',
].join('\n');

test('같은 파일을 다시 올리면 겹친 줄은 빼고, 한 파일 안의 같은 결제 두 건은 둘 다 남긴다', () => {
  const input = { name: 'kakaopay.csv', text: csv, kind: 'pay' as const, institution: '카카오페이' };
  const first = parseFile(input, new Set(), 'u1');
  assert.equal(first.transactions.length, 3);
  assert.equal(new Set(first.transactions.map((t) => t.fingerprint)).size, 3);
  assert.deepEqual([first.upload.firstDate, first.upload.lastDate], ['2026-10-06', '2026-10-16']);

  const again = parseFile(input, new Set(first.transactions.map((t) => t.fingerprint)), 'u2');
  assert.equal(again.upload.count, 0);
  assert.equal(again.duplicates, 3);
  // 기간이 겹치는 새 파일: 새 줄만 들어온다.
  const longer = parseFile({ ...input, text: csv + '\n2026-10-20 09:00:00,결제,카카오T 택시,"-12,000",농협 계좌,완료' }, new Set(first.transactions.map((t) => t.fingerprint)), 'u3');
  assert.deepEqual(longer.transactions.map((t) => t.merchant), ['카카오T 택시']);
});

// 엔진의 시험용 엑셀 (가상 데이터, 비밀번호 test1234)
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../packages/engine/test/fixtures/${name}`, import.meta.url)));

test('비밀번호가 걸린 엑셀은 비밀번호를 받아서 열고, 표를 내역으로 가져온다', () => {
  const name = '토스뱅크_거래내역.xlsx';
  const bytes = fixture('bank-standard.xlsx');
  const locked = openFile(name, bytes);
  assert.equal(locked.kind, null);
  assert.equal(locked.locked, bytes);
  assert.equal(locked.wrongPassword, false);
  assert.match(locked.problem!, /비밀번호/);

  const wrong = openFile(name, bytes, '000000');
  assert.equal(wrong.locked, bytes);
  assert.equal(wrong.wrongPassword, true);

  const opened = openFile(name, bytes, 'test1234');
  assert.equal(opened.locked, undefined);
  assert.deepEqual([opened.kind, opened.institution, opened.problem], ['bank', '토스뱅크', undefined]);
  const parsed = parseFile({ name, text: opened.text, rows: opened.rows, kind: 'bank', institution: opened.institution }, new Set(), 'u1');
  assert.deepEqual(
    parsed.transactions.map((t) => [t.merchant, t.direction, t.amount]),
    [
      ['넷플릭스', 'out', 13500],
      ['홍길동 (내 계좌)', 'in', 100000],
    ],
  );
});

test('비밀번호 없는 엑셀은 바로 읽고, CSV는 글자로 읽는다', () => {
  const xlsx = openFile('statement.xlsx', fixture('bank-plain.xlsx'));
  assert.deepEqual([xlsx.kind, xlsx.locked, xlsx.rows?.length], ['bank', undefined, 5]);
  const csv = openFile('nh.csv', new TextEncoder().encode('거래일시,구분,내용,거래금액,거래후잔액\n'));
  assert.deepEqual([csv.kind, csv.institution, csv.rows], ['bank', '농협은행', undefined]);
  assert.match(openFile('내역.pdf', new TextEncoder().encode('%PDF-1.7')).problem!, /PDF/);
});
