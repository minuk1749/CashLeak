// 비밀번호가 걸린 엑셀(.xlsx)은 zip이 아니라 MS 복합 문서(Compound File Binary) 안에 암호화된 채로 들어 있다.
// 암호를 푸는 데 필요한 스트림(EncryptionInfo, EncryptedPackage)만 꺼내면 되므로 읽기만 구현한다.
// 형식: [MS-CFB] https://learn.microsoft.com/openspecs/windows_protocols/ms-cfb

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE_SECTOR = 0xffffffff;
const NO_STREAM = 0xffffffff;
const HEADER_FAT_SLOTS = 109;

const STORAGE = 1;
const STREAM = 2;

interface DirEntry {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

export function isCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((b, i) => bytes[i] === b);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function toUint32s(b: Uint8Array): Uint32Array {
  const dv = view(b);
  const out = new Uint32Array(Math.floor(b.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = dv.getUint32(i * 4, true);
  return out;
}

/** 복합 문서 안의 스트림을 경로('EncryptionInfo', '\u0006DataSpaces/Version' 등)별로 꺼낸다. */
export function readCompoundFile(bytes: Uint8Array): Map<string, Uint8Array> {
  if (!isCompoundFile(bytes)) throw new Error('복합 문서 형식이 아닙니다.');
  const header = view(bytes);
  const sectorSize = 1 << header.getUint16(0x1e, true);
  const miniSectorSize = 1 << header.getUint16(0x20, true);
  if (sectorSize !== 512 && sectorSize !== 4096) throw new Error('복합 문서의 섹터 크기가 잘못되었습니다.');
  const fatSectorCount = header.getUint32(0x2c, true);
  const miniCutoff = header.getUint32(0x38, true);
  const sectorTotal = Math.ceil(bytes.length / sectorSize);

  // 헤더 다음부터 섹터 0이 시작한다 (헤더도 한 섹터 크기를 차지한다).
  const sector = (n: number) => {
    const start = (n + 1) * sectorSize;
    if (n >= sectorTotal || start >= bytes.length) throw new Error('복합 문서가 잘렸거나 손상되었습니다.');
    return bytes.subarray(start, Math.min(start + sectorSize, bytes.length));
  };

  // FAT가 어느 섹터들에 있는지: 헤더에 109개, 나머지는 DIFAT 섹터를 따라간다.
  const fatSectors: number[] = [];
  for (let i = 0; i < HEADER_FAT_SLOTS && fatSectors.length < fatSectorCount; i++) {
    fatSectors.push(header.getUint32(0x4c + i * 4, true));
  }
  let difat = header.getUint32(0x44, true);
  for (let guard = 0; difat !== END_OF_CHAIN && difat !== FREE_SECTOR && fatSectors.length < fatSectorCount; guard++) {
    if (guard > sectorTotal) throw new Error('복합 문서의 섹터 연결이 잘못되었습니다.');
    const entries = toUint32s(sector(difat));
    for (let i = 0; i < entries.length - 1 && fatSectors.length < fatSectorCount; i++) fatSectors.push(entries[i]);
    difat = entries[entries.length - 1];
  }
  const fat = toUint32s(concat(fatSectors.map(sector)));

  const chain = (start: number, table: Uint32Array) => {
    const out: number[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== END_OF_CHAIN && s !== FREE_SECTOR; s = table[s]) {
      if (s >= table.length || seen.has(s)) throw new Error('복합 문서의 섹터 연결이 잘못되었습니다.');
      seen.add(s);
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number, size?: number) => {
    const data = concat(chain(start, fat).map(sector));
    return size === undefined ? data : data.subarray(0, size);
  };

  const dir = readChain(header.getUint32(0x30, true));
  const dv = view(dir);
  const entries: DirEntry[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameBytes = Math.min(64, Math.max(0, dv.getUint16(o + 0x40, true) - 2));
    const low = dv.getUint32(o + 0x78, true);
    // 512바이트 섹터 형식(버전 3)은 크기의 상위 32비트에 쓰레기 값이 있을 수 있어 무시한다.
    const high = sectorSize === 512 ? 0 : dv.getUint32(o + 0x7c, true);
    entries.push({
      name: new TextDecoder('utf-16le').decode(dir.subarray(o, o + nameBytes)),
      type: dir[o + 0x42],
      left: dv.getUint32(o + 0x44, true),
      right: dv.getUint32(o + 0x48, true),
      child: dv.getUint32(o + 0x4c, true),
      start: dv.getUint32(o + 0x74, true),
      size: high * 2 ** 32 + low,
    });
  }
  const root = entries[0];
  if (!root) throw new Error('복합 문서에 디렉터리가 없습니다.');

  // 작은 스트림(보통 4096바이트 미만)은 루트 항목이 가리키는 미니 스트림 안에 64바이트 단위로 들어 있다.
  const miniStream = root.start === END_OF_CHAIN ? new Uint8Array() : readChain(root.start, root.size);
  const firstMiniFat = header.getUint32(0x3c, true);
  const miniFat = firstMiniFat === END_OF_CHAIN ? new Uint32Array() : toUint32s(readChain(firstMiniFat));
  const readMini = (start: number, size: number) => {
    const parts = chain(start, miniFat).map((n) => miniStream.subarray(n * miniSectorSize, (n + 1) * miniSectorSize));
    return concat(parts).subarray(0, size);
  };

  const streams = new Map<string, Uint8Array>();
  const visited = new Set<number>();
  const visit = (id: number, prefix: string) => {
    if (id === NO_STREAM || id >= entries.length || visited.has(id)) return;
    visited.add(id);
    const e = entries[id];
    visit(e.left, prefix);
    const path = prefix + e.name;
    if (e.type === STREAM) streams.set(path, e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size));
    else if (e.type === STORAGE) visit(e.child, `${path}/`);
    visit(e.right, prefix);
  };
  visit(root.child, '');
  return streams;
}
