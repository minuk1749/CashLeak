import { strFromU8, unzipSync } from 'fflate';
import { isCompoundFile, readCompoundFile } from './cfb.ts';
import { decryptOfficePackage, PasswordError } from './office-crypto.ts';

// 은행·카드·간편결제 앱이 내려 주는 엑셀(.xlsx)을 표(문자열 2차원 배열)로 읽는다.
// .xlsx는 XML 파일들을 zip으로 묶은 것이고, 비밀번호가 걸려 있으면 그 zip이 통째로 암호화되어 있다.
// 거래내역 표만 필요하므로 서식·수식은 무시하고 셀에 보이는 값만 꺼낸다.

export interface Sheet {
  name: string;
  rows: string[][];
}

export type SpreadsheetProblem = 'password-required' | 'wrong-password' | 'unsupported';

export class SpreadsheetError extends Error {
  readonly problem: SpreadsheetProblem;
  constructor(message: string, problem: SpreadsheetProblem) {
    super(message);
    this.name = 'SpreadsheetError';
    this.problem = problem;
  }
}

export interface ReadOptions {
  /** 파일에 걸린 비밀번호 (보통 생년월일). 기기 안에서 파일을 여는 데만 쓴다. */
  password?: string;
}

const isZip = (b: Uint8Array) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b;

/** 엑셀 파일로 보이는지 (.xlsx, 비밀번호가 걸린 .xlsx, 예전 .xls). 아니면 CSV 같은 글자 파일로 읽는다. */
export function looksLikeSpreadsheet(bytes: Uint8Array): boolean {
  return isZip(bytes) || isCompoundFile(bytes);
}

/** 비밀번호를 물어봐야 하는 파일인지 (암호화된 .xlsx) */
export function isEncryptedSpreadsheet(bytes: Uint8Array): boolean {
  if (!isCompoundFile(bytes)) return false;
  try {
    return readCompoundFile(bytes).has('EncryptionInfo');
  } catch {
    return false;
  }
}

/** 암호가 걸려 있으면 풀어서 .xlsx(zip) 내용을 돌려준다. */
function unlock(bytes: Uint8Array, password: string | undefined): Uint8Array {
  if (isZip(bytes)) return bytes;
  if (!isCompoundFile(bytes)) throw new SpreadsheetError('엑셀(.xlsx) 파일이 아니에요.', 'unsupported');
  const streams = readCompoundFile(bytes);
  if (!streams.has('EncryptionInfo')) {
    throw new SpreadsheetError('예전 엑셀 형식(.xls)은 아직 읽지 못해요. 엑셀에서 .xlsx나 CSV로 저장해 올려 주세요.', 'unsupported');
  }
  if (!password) throw new SpreadsheetError('비밀번호가 걸린 파일이에요.', 'password-required');
  try {
    const zip = decryptOfficePackage(streams, password);
    if (!isZip(zip)) throw new PasswordError();
    return zip;
  } catch (e) {
    if (e instanceof PasswordError) throw new SpreadsheetError('비밀번호가 맞지 않아요.', 'wrong-password');
    throw new SpreadsheetError((e as Error).message, 'unsupported');
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s
    .replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (m, dec, hex, name) =>
      dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name] ?? m),
    )
    .replace(/_x([0-9A-F]{4})_/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decodeXml(m[2] ?? m[3]);
  return out;
}

/** <si>·<is> 안의 글자. 서식이 다른 조각(<r><t>)은 이어 붙이고, 일본어 읽기 표기(<rPh>)는 뺀다. */
function richText(xml: string): string {
  let out = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    out += decodeXml(m[1] ?? '');
  }
  return out;
}

/** <x:row> 처럼 접두어가 붙은 태그를 <row>로 맞춘다. */
const stripPrefixes = (xml: string) => xml.replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');

function resolvePath(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

function relationships(files: Record<string, string>, part: string): { type: string; target: string; id: string }[] {
  const dir = part.split('/').slice(0, -1).join('/');
  const relsPath = `${dir ? `${dir}/` : ''}_rels/${part.split('/').pop()}.rels`;
  const xml = files[relsPath];
  if (!xml) return [];
  return [...xml.matchAll(/<Relationship\b([^>]*)>/g)].map((m) => {
    const a = attributes(m[1]);
    return { id: a.Id, type: a.Type ?? '', target: resolvePath(part, a.Target ?? '') };
  });
}

// 날짜 서식 번호 (엑셀 내장). 27~36, 50~58은 한국어 등 동아시아 날짜 서식이다.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '');
  return /[ymdhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

/** 셀 서식(s 속성) 번호별로 날짜 서식인지 */
function dateStyles(xml: string | undefined): boolean[] {
  if (!xml) return [];
  const custom = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)>/g)) {
    const a = attributes(m[1]);
    custom.set(Number(a.numFmtId), a.formatCode ?? '');
  }
  const cellXfs = xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? '';
  return [...cellXfs.matchAll(/<xf\b([^>]*)>/g)].map((m) => {
    const id = Number(attributes(m[1]).numFmtId ?? 0);
    const code = custom.get(id);
    return code !== undefined ? isDateFormat(code) : BUILTIN_DATE_FORMATS.has(id);
  });
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 엑셀 날짜 일련번호 → 'YYYY-MM-DD HH:MM:SS' (시간이 없으면 날짜만, 날짜가 없으면 시간만) */
function serialToText(serial: number, date1904: boolean): string {
  const days = serial + (date1904 ? 1462 : 0);
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(days * 86_400) * 1000);
  const date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  const time = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  if (serial < 1) return time;
  return Number.isInteger(serial) ? date : `${date} ${time}`;
}

const numberText = (v: number) => String(Number(v.toPrecision(15)));

function columnIndex(ref: string | undefined): number | undefined {
  const letters = ref?.match(/^[A-Z]+/)?.[0];
  if (!letters) return undefined;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

interface Context {
  strings: string[];
  dates: boolean[];
  date1904: boolean;
}

function cellText(attrs: Record<string, string>, inner: string, ctx: Context): string {
  const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  switch (attrs.t) {
    case 's':
      return ctx.strings[Number(v)] ?? '';
    case 'inlineStr':
      return richText(inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? '');
    case 'str':
      return decodeXml(v ?? '');
    case 'b':
      return v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
    case 'e':
      return '';
    case 'd':
      return decodeXml(v ?? '').replace('T', ' ').replace(/(\.\d+)?Z$/, '');
    default: {
      if (v === undefined || v.trim() === '') return '';
      const n = Number(v);
      if (!Number.isFinite(n)) return decodeXml(v);
      return ctx.dates[Number(attrs.s ?? 0)] ? serialToText(n, ctx.date1904) : numberText(n);
    }
  }
}

function readRows(xml: string, ctx: Context): string[][] {
  const data = xml.match(/<sheetData\b[^>]*>([\s\S]*?)<\/sheetData>/)?.[1] ?? '';
  const rows: string[][] = [];
  for (const rm of data.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = attributes(cm[1]);
      const col = columnIndex(attrs.r) ?? next;
      while (row.length < col) row.push('');
      row[col] = cellText(attrs, cm[2] ?? '', ctx);
      next = col + 1;
    }
    rows.push(row);
  }
  return rows;
}

/** .xlsx(비밀번호가 걸린 것 포함)의 모든 시트를 문자열 표로 읽는다. */
export function readXlsx(bytes: Uint8Array, options: ReadOptions = {}): Sheet[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(unlock(bytes, options.password), { filter: (f) => /\.(xml|rels)$/i.test(f.name) });
  } catch (e) {
    if (e instanceof SpreadsheetError) throw e;
    throw new SpreadsheetError('엑셀 파일이 손상되었거나 읽을 수 없는 형식이에요.', 'unsupported');
  }
  const files: Record<string, string> = {};
  for (const [name, data] of Object.entries(entries)) files[name] = stripPrefixes(strFromU8(data));

  const workbookPath = relationships(files, '').find((r) => r.type.endsWith('/officeDocument'))?.target ?? 'xl/workbook.xml';
  const workbook = files[workbookPath];
  if (!workbook) throw new SpreadsheetError('엑셀 파일에서 시트 목록을 찾지 못했어요.', 'unsupported');
  const rels = relationships(files, workbookPath);
  const relTarget = (suffix: string) => rels.find((r) => r.type.endsWith(suffix))?.target;

  const sst = files[relTarget('/sharedStrings') ?? 'xl/sharedStrings.xml'];
  const ctx: Context = {
    strings: sst ? [...sst.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => richText(m[1] ?? '')) : [],
    dates: dateStyles(files[relTarget('/styles') ?? 'xl/styles.xml']),
    date1904: /<workbookPr\b[^>]*date1904\s*=\s*["'](1|true)["']/i.test(workbook),
  };

  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(/<sheet\b([^>]*)>/g)) {
    const a = attributes(m[1]);
    const relId = Object.entries(a).find(([k]) => k === 'id' || k.endsWith(':id'))?.[1];
    const target = rels.find((r) => r.id === relId)?.target;
    const xml = target ? files[target] : undefined;
    if (xml) sheets.push({ name: a.name ?? '', rows: readRows(xml, ctx) });
  }
  return sheets;
}
