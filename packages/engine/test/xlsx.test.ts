import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { detectKind, importRows } from '../src/io/importers.ts';
import { isEncryptedSpreadsheet, looksLikeSpreadsheet, readXlsx, SpreadsheetError, type SpreadsheetProblem } from '../src/io/xlsx.ts';

// fixtures/의 엑셀은 make-encrypted.py로 만든 가상 데이터다. 비밀번호는 모두 test1234.
const PASSWORD = 'test1234';
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

function rejects(fn: () => unknown, problem: SpreadsheetProblem, message?: RegExp) {
  assert.throws(fn, (e) => e instanceof SpreadsheetError && e.problem === problem && (!message || message.test(e.message)));
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// 0: 평범한 글자, 1: 서식이 다른 조각들, 2: 읽기 표기(rPh)가 붙은 글자, 3: XML 문자 참조
const SHARED_STRINGS =
  '<sst><si><t>거래일시</t></si>' +
  '<si><r><t>넷</t></r><r><rPr><b/></rPr><t xml:space="preserve">플릭스 </t></r></si>' +
  '<si><t>カード</t><rPh sb="0" eb="3"><t>カアド</t></rPh></si>' +
  '<si><t>A &amp; B &#54620;</t></si></sst>';

// 셀 서식 0: 일반, 1: 내장 날짜(14), 2: 직접 만든 날짜·시각, 3: '#,##0"원"' (글자 d가 있어도 날짜가 아니다)
const STYLES =
  '<styleSheet><numFmts count="2">' +
  '<numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm:ss"/>' +
  '<numFmt numFmtId="165" formatCode="#,##0&quot;원 (dd)&quot;"/></numFmts>' +
  '<cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>' +
  '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';

/** 엑셀이 저장하는 것과 같은 구조의 .xlsx를 만든다. 시트 목록에는 내용이 없는 시트도 하나 넣는다. */
function book(sheets: string[], workbookPr = ''): Uint8Array {
  const parts: Record<string, string> = {
    '_rels/.rels': `<Relationships><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml':
      `<workbook xmlns:r="${REL}">${workbookPr}<sheets>` +
      sheets.map((_, i) => `<sheet name="시트${i + 1}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '<sheet name="없는 시트" sheetId="9" r:id="rId9"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships>' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rIdS" Type="${REL}/sharedStrings" Target="/xl/sharedStrings.xml"/>` +
      `<Relationship Id="rIdT" Type="${REL}/styles" Target="../xl/styles.xml"/></Relationships>`,
    'xl/sharedStrings.xml': SHARED_STRINGS,
    'xl/styles.xml': STYLES,
  };
  sheets.forEach((xml, i) => (parts[`xl/worksheets/sheet${i + 1}.xml`] = xml));
  return zipSync(Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, strToU8(xml)])));
}

test('셀 종류와 서식에 맞춰 화면에 보이는 값을 꺼낸다', () => {
  // 일부 프로그램은 태그에 접두어(x:)를 붙이고, 셀 위치(r)를 빼먹거나 빈칸을 건너뛰고 저장한다.
  const sheet =
    '<x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>' +
    '<x:row r="1"><x:c r="A1" t="s"><x:v>0</x:v></x:c><x:c r="C1" t="inlineStr"><x:is><x:t>메모</x:t></x:is></x:c></x:row>' +
    '<x:row r="2"><x:c r="A2" s="2"><x:v>46296.395833333336</x:v></x:c><x:c r="B2" t="s"><x:v>1</x:v></x:c>' +
    '<x:c r="C2" s="3"><x:v>-13500</x:v></x:c><x:c r="D2" s="1"><x:v>46296</x:v></x:c><x:c r="E2" s="2"><x:v>0.5</x:v></x:c></x:row>' +
    '<x:row r="3"/>' +
    '<x:row r="4"><x:c t="s"><x:v>2</x:v></x:c><x:c t="str"><x:f>A1&amp;"!"</x:f><x:v>합계 &lt;1&gt;</x:v></x:c>' +
    '<x:c t="b"><x:v>1</x:v></x:c><x:c t="e"><x:v>#N/A</x:v></x:c><x:c t="d"><x:v>2026-10-01T09:30:00Z</x:v></x:c>' +
    '<x:c><x:v>0.30000000000000004</x:v></x:c><x:c s="1"/><x:c t="s"><x:v>3</x:v></x:c></x:row>' +
    '</x:sheetData></x:worksheet>';
  const second = '<worksheet><sheetData><row r="1"><c r="B1" t="inlineStr"><is><r><t>요</t></r><r><t>약</t></r></is></c></row></sheetData></worksheet>';

  assert.deepEqual(readXlsx(book([sheet, second])), [
    {
      name: '시트1',
      rows: [
        ['거래일시', '', '메모'],
        ['2026-10-01 09:30:00', '넷플릭스 ', '-13500', '2026-10-01', '12:00:00'],
        [],
        ['カード', '합계 <1>', 'TRUE', '', '2026-10-01 09:30:00', '0.3', '', 'A & B 한'],
      ],
    },
    { name: '시트2', rows: [['', '요약']] },
  ]);
});

test('1904년 기준 날짜를 쓰는 파일(옛 맥 엑셀)도 날짜를 맞게 읽는다', () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" s="1"><v>44834</v></c></row></sheetData></worksheet>';
  assert.deepEqual(readXlsx(book([sheet], '<workbookPr date1904="1"/>'))[0].rows, [['2026-10-01']]);
  assert.deepEqual(readXlsx(book([sheet]))[0].rows, [['2022-09-30']]);
});

test('엑셀이 아니거나 손상된 파일은 읽을 수 없다고 알려 준다', () => {
  assert.equal(looksLikeSpreadsheet(strToU8('거래일시,금액\n')), false);
  rejects(() => readXlsx(strToU8('거래일시,금액\n2026-10-01,1000\n')), 'unsupported');
  rejects(() => readXlsx(Uint8Array.of(0x50, 0x4b, 3, 4, 0, 0, 0, 0)), 'unsupported');
  rejects(() => readXlsx(zipSync({ 'docProps/app.xml': strToU8('<Properties/>') })), 'unsupported', /시트 목록/);
});

const EXPECTED = readXlsx(fixture('bank-plain.xlsx'));

test('openpyxl로 저장한 엑셀을 읽는다', () => {
  assert.equal(looksLikeSpreadsheet(fixture('bank-plain.xlsx')), true);
  assert.equal(isEncryptedSpreadsheet(fixture('bank-plain.xlsx')), false);
  assert.deepEqual(EXPECTED.map((s) => s.name), ['거래내역']);
  assert.deepEqual(EXPECTED[0].rows, [
    ['', '가상 은행 거래내역'],
    ['', '성명', '홍길동'],
    ['', '거래 일시', '적요', '거래 유형', '거래 금액', '거래 후 잔액', '처리일'],
    ['', '2026.10.01 09:00:00', '넷플릭스', '체크카드결제', '-13500', '86500', '2026-10-01 09:00:00'],
    ['', '2026.09.30 12:00:00', '홍길동', '입금', '100000', '100000', '2026-09-30', ''],
  ]);
});

// 표준: 토스뱅크 거래내역과 같은 방식. 에자일 SHA-1: 카카오페이 머니 거래내역과 같은 방식. 에자일 SHA-512: 엑셀 기본값.
for (const name of ['bank-standard.xlsx', 'bank-agile-sha1.xlsx', 'bank-agile-sha512.xlsx']) {
  test(`비밀번호가 걸린 엑셀을 푼다: ${name}`, () => {
    const bytes = fixture(name);
    assert.equal(looksLikeSpreadsheet(bytes), true);
    assert.equal(isEncryptedSpreadsheet(bytes), true);
    assert.deepEqual(readXlsx(bytes, { password: PASSWORD }), EXPECTED);
    rejects(() => readXlsx(bytes), 'password-required');
    rejects(() => readXlsx(bytes, { password: 'test1235' }), 'wrong-password');
  });
}

test('암호화 정보가 없는 복합 문서(예전 .xls 형식)는 아직 못 읽는다고 알려 준다', () => {
  const buf = Buffer.from(fixture('bank-standard.xlsx'));
  const at = buf.indexOf(Buffer.from('EncryptionInfo', 'utf16le'));
  assert.ok(at > 0);
  buf.write('W', at, 'utf16le');
  const bytes = new Uint8Array(buf);
  assert.equal(isEncryptedSpreadsheet(bytes), false);
  rejects(() => readXlsx(bytes, { password: PASSWORD }), 'unsupported', /\.xls/);
});

test('비밀번호를 푼 엑셀의 표를 통장 내역으로 가져온다', () => {
  const [sheet] = readXlsx(fixture('bank-agile-sha1.xlsx'), { password: PASSWORD });
  assert.equal(detectKind(sheet.rows), 'bank');
  const txs = importRows(sheet.rows, 'bank', { institution: '가상은행' });
  assert.deepEqual(
    txs.map((t) => [t.date, t.time, t.merchant, t.direction, t.amount, t.method]),
    [
      ['2026-10-01', '09:00:00', '넷플릭스', 'out', 13500, '체크카드결제'],
      // 머리글 위 '성명'에 적힌 예금주와 같은 이름으로 오간 돈은 내 계좌끼리 옮긴 돈이다.
      ['2026-09-30', '12:00:00', '홍길동 (내 계좌)', 'in', 100000, '입금'],
    ],
  );
});
