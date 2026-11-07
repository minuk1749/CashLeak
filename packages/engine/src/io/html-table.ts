// 농협은행처럼 '엑셀 저장'이라면서 HTML 표를 .xls 이름으로 내려 주는 은행이 많다. 엑셀은 이런 파일을 열면
// <table>들을 위에서부터 차례로 시트에 펼쳐 보여 준다. 여기서도 그렇게 모든 표를 하나의 표(string[][])로 펼친다.
// 합친 칸(colspan·rowspan)은 엑셀처럼 첫 칸에만 값을 두고 나머지는 빈칸으로 채운다.

/** 글자로 읽은 파일이 HTML 표인지 (CSV가 아니라) */
export function looksLikeHtmlTable(text: string): boolean {
  return /^\s*</.test(text) && /<t[dh][\s>]/i.test(text);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] ?? whole;
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

/** 셀 안의 줄바꿈(<br>)과 공백은 빈칸 하나로. \s는 전각 공백(U+3000)과 줄바꿈 없는 공백(U+00A0)도 포함한다. */
const tidy = (text: string) => text.replace(/\s+/g, ' ').trim();

function span(attrs: string, name: string): number {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']?(\\d+)`, 'i'));
  return m ? Math.min(Math.max(Number(m[1]), 1), 1000) : 1;
}

interface Table {
  rows: string[][];
  /** 위 줄의 rowspan이 차지한 칸: 줄 번호 → 칸 번호들 */
  taken: Map<number, Set<number>>;
}

interface Cell {
  table: Table;
  row: number;
  col: number;
  text: string;
}

const TOKEN = /<!--[\s\S]*?-->|<(script|style|head)\b[^>]*>[\s\S]*?<\/\1\s*>|<(\/?)([a-z][\w:-]*)([^>]*)>|([^<]+)|</gi;

/** HTML 안의 모든 표를 차례로 펼친 하나의 표 */
export function readHtmlTable(html: string): string[][] {
  const out: string[][] = [];
  const tables: Table[] = [];
  let cell: Cell | null = null;

  const finishCell = () => {
    if (!cell) return;
    const row = cell.table.rows[cell.row];
    while (row.length < cell.col) row.push('');
    row[cell.col] = tidy(decodeEntities(cell.text));
    cell = null;
  };
  const startRow = (t: Table) => {
    const row: string[] = [];
    t.rows.push(row);
    out.push(row);
  };

  for (const m of html.matchAll(TOKEN)) {
    const [, , closing, rawName, attrs = '', text] = m;
    if (text !== undefined || m[0] === '<') {
      if (cell) cell.text += m[0];
      continue;
    }
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    const table = tables.at(-1);
    if (name === 'br' || ((name === 'p' || name === 'div') && closing)) {
      if (cell) cell.text += '\n';
    } else if (name === 'table') {
      finishCell();
      if (closing) tables.pop();
      else tables.push({ rows: [], taken: new Map() });
    } else if (name === 'tr' && table) {
      finishCell();
      if (!closing) startRow(table);
    } else if ((name === 'td' || name === 'th') && table) {
      finishCell();
      if (closing) continue;
      if (table.rows.length === 0) startRow(table);
      const r = table.rows.length - 1;
      const taken = table.taken.get(r) ?? new Set<number>();
      let c = table.rows[r].length;
      while (taken.has(c)) c++;
      const cols = span(attrs, 'colspan');
      const rows = span(attrs, 'rowspan');
      for (let dr = 0; dr < rows; dr++) {
        const set = table.taken.get(r + dr) ?? new Set<number>();
        for (let dc = 0; dc < cols; dc++) set.add(c + dc);
        table.taken.set(r + dr, set);
      }
      const row = table.rows[r];
      while (row.length < c + cols) row.push('');
      cell = { table, row: r, col: c, text: '' };
    }
  }
  finishCell();
  // 합친 칸 때문에 생긴 줄 끝의 빈칸은 뺀다.
  for (const row of out) while (row.length && row.at(-1) === '') row.pop();
  return out;
}
