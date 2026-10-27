import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonths, anchoredDate, diffDays, kstDate, monthIndex } from '../src/dates.ts';

test('없는 날짜(31일, 2월 29일)는 그 달 말일로 맞춘다', () => {
  assert.equal(anchoredDate(monthIndex('2026-02-01'), 31), '2026-02-28');
  assert.equal(anchoredDate(monthIndex('2026-04-01'), 31), '2026-04-30');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-02-28', 1, 31), '2026-03-31');
});

test('연말을 넘어가는 월 계산', () => {
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(diffDays('2026-12-30', '2027-01-02'), 3);
});

test('메일 시각은 KST 날짜로 바꾼다', () => {
  assert.equal(kstDate('2026-05-03T16:30:00Z'), '2026-05-04');
  assert.equal(kstDate('2026-05-03T23:59:00+09:00'), '2026-05-03');
});
