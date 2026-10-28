import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMonth, formatNote, formatPeriod, formatShortPeriod } from './format.ts';

test('기간은 해가 바뀔 때만 끝 날짜에도 연도를 붙인다', () => {
  assert.equal(formatPeriod('2026-05-01', '2026-10-26'), '2026년 5월 1일 ~ 10월 26일');
  assert.equal(formatPeriod('2025-10-30', '2026-10-26'), '2025년 10월 30일 ~ 2026년 10월 26일');
  assert.equal(formatShortPeriod('2026-05-01', '2026-10-26'), '26.5.1 ~ 10.26');
  assert.equal(formatShortPeriod('2025-10-30', '2026-10-26'), '25.10.30 ~ 26.10.26');
});

test('월 머리글은 올해가 아닐 때만 연도를 붙인다', () => {
  assert.equal(formatMonth('2026-10', '2026'), '10월');
  assert.equal(formatMonth('2025-12', '2026'), '2025년 12월');
});

test('탐지 메모 속 날짜를 화면 표기로 바꾼다', () => {
  assert.equal(formatNote('예정일(2026-10-19)이 지나도 결제가 없어 해지로 추정', '2026'), '예정일(10월 19일)이 지나도 결제가 없어 해지로 추정');
  assert.equal(formatNote('가격 변경 10,900원 → 11,900원 (2025-12-16)', '2026'), '가격 변경 10,900원 → 11,900원 (2025년 12월 16일)');
  assert.equal(formatNote('매달 금액이 달라짐', '2026'), '매달 금액이 달라짐');
});
