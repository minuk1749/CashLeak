import { cbc, ecb } from '@noble/ciphers/aes.js';
import { sha1 } from '@noble/hashes/legacy.js';
import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js';

// 비밀번호가 걸린 엑셀의 암호를 푼다. [MS-OFFCRYPTO] ECMA-376 표준(Standard)·에자일(Agile) 암호화.
// 실제로 받은 파일: 토스뱅크 내역은 표준(AES-128, SHA-1), 카카오페이 머니 내역은 에자일(AES-128, SHA-1) 방식.
// https://learn.microsoft.com/openspecs/office_file_formats/ms-offcrypto

/** 비밀번호가 틀렸을 때 */
export class PasswordError extends Error {}

type Hash = (data: Uint8Array) => Uint8Array;

const HASHES: Record<string, Hash> = { SHA1: sha1, SHA256: sha256, SHA384: sha384, SHA512: sha512 };

// 에자일 방식에서 키를 용도별로 나누는 블록 값
const BLOCK_VERIFIER_INPUT = Uint8Array.of(0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79);
const BLOCK_VERIFIER_VALUE = Uint8Array.of(0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e);
const BLOCK_KEY_VALUE = Uint8Array.of(0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6);
const SEGMENT = 4096;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function le32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  view(out).setUint32(0, n, true);
  return out;
}

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    out[i * 2] = s.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = s.charCodeAt(i) >> 8;
  }
  return out;
}

/** 해시가 키보다 짧으면 0x36으로 채우고, 길면 자른다. */
function fit(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length >= length) return bytes.subarray(0, length);
  const out = new Uint8Array(length).fill(0x36);
  out.set(bytes);
  return out;
}

/** H(salt + 비밀번호)를 spinCount번 다시 해시한다. 비밀번호 대입을 느리게 만드는 장치라 수만 번 돈다. */
function iteratedHash(hash: Hash, salt: Uint8Array, password: string, spinCount: number): Uint8Array {
  let h = hash(concat(salt, utf16le(password)));
  const buf = new Uint8Array(4 + h.length);
  const dv = view(buf);
  for (let i = 0; i < spinCount; i++) {
    dv.setUint32(0, i, true);
    buf.set(h, 4);
    h = hash(buf);
  }
  return h;
}

/** 블록 단위로 맞지 않는 꼬리는 버린다 (암호화된 패키지는 블록 크기로 채워져 있다). */
const whole = (data: Uint8Array) => data.subarray(0, data.length - (data.length % 16));

function packageSize(pkg: Uint8Array): number {
  const dv = view(pkg);
  return dv.getUint32(0, true) + dv.getUint32(4, true) * 2 ** 32;
}

function decryptStandard(info: Uint8Array, pkg: Uint8Array, password: string): Uint8Array {
  const dv = view(info);
  const flags = dv.getUint32(4, true);
  const headerSize = dv.getUint32(8, true);
  const algId = dv.getUint32(12 + 8, true);
  const algIdHash = dv.getUint32(12 + 12, true);
  const keyBits = dv.getUint32(12 + 16, true) || 128;
  const isAes = (flags & 0x20) !== 0 && [0, 0x660e, 0x660f, 0x6610].includes(algId);
  if (!isAes || (algIdHash !== 0 && algIdHash !== 0x8004)) throw new Error('지원하지 않는 엑셀 암호화 방식입니다.');

  const v = 12 + headerSize;
  const saltSize = dv.getUint32(v, true);
  const salt = info.subarray(v + 4, v + 4 + saltSize);
  const encryptedVerifier = info.subarray(v + 4 + saltSize, v + 20 + saltSize);
  const verifierHashSize = dv.getUint32(v + 20 + saltSize, true);
  const encryptedVerifierHash = info.subarray(v + 24 + saltSize, v + 24 + saltSize + 32);

  const h = sha1(concat(iteratedHash(sha1, salt, password, 50_000), le32(0)));
  const pad = (byte: number) => {
    const buf = new Uint8Array(64).fill(byte);
    h.forEach((x, i) => (buf[i] ^= x));
    return sha1(buf);
  };
  const key = concat(pad(0x36), pad(0x5c)).subarray(0, keyBits / 8);
  const aes = ecb(key, { disablePadding: true });
  const verifier = aes.decrypt(encryptedVerifier);
  const verifierHash = aes.decrypt(encryptedVerifierHash).subarray(0, verifierHashSize);
  if (!equal(sha1(verifier), verifierHash)) throw new PasswordError('비밀번호가 맞지 않습니다.');
  return aes.decrypt(whole(pkg.subarray(8))).subarray(0, packageSize(pkg));
}

/** <keyData saltValue="..."/> 같은 태그의 속성들 */
function tagAttributes(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of xml.matchAll(new RegExp(`<(?:[\\w.-]+:)?${tag}\\b([^>]*)>`, 'g'))) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

function hashOf(name: string | undefined): Hash {
  const hash = HASHES[(name ?? '').replace('-', '').toUpperCase()];
  if (!hash) throw new Error(`지원하지 않는 엑셀 암호화 해시입니다: ${name}`);
  return hash;
}

function decryptAgile(info: Uint8Array, pkg: Uint8Array, password: string): Uint8Array {
  const xml = new TextDecoder().decode(info.subarray(8));
  const keyData = tagAttributes(xml, 'keyData')[0];
  // 인증서로 거는 암호도 있지만, 은행·카드 앱이 주는 파일은 비밀번호 방식이다.
  const key = tagAttributes(xml, 'encryptedKey').find((a) => a.spinCount);
  if (!keyData || !key) throw new Error('엑셀 암호화 정보를 읽지 못했습니다.');
  for (const params of [keyData, key]) {
    if (params.cipherAlgorithm !== 'AES' || params.cipherChaining !== 'ChainingModeCBC') {
      throw new Error('지원하지 않는 엑셀 암호화 방식입니다.');
    }
  }

  const hash = hashOf(key.hashAlgorithm);
  const keyBytes = Number(key.keyBits) / 8;
  const salt = fromBase64(key.saltValue);
  const h = iteratedHash(hash, salt, password, Number(key.spinCount));
  const decryptWith = (block: Uint8Array, value: string) =>
    cbc(fit(hash(concat(h, block)), keyBytes), fit(salt, Number(key.blockSize)), { disablePadding: true }).decrypt(fromBase64(value));

  const verifierInput = decryptWith(BLOCK_VERIFIER_INPUT, key.encryptedVerifierHashInput).subarray(0, Number(key.saltSize));
  const verifierHash = decryptWith(BLOCK_VERIFIER_VALUE, key.encryptedVerifierHashValue).subarray(0, Number(key.hashSize));
  if (!equal(hash(verifierInput), verifierHash)) throw new PasswordError('비밀번호가 맞지 않습니다.');
  const secretKey = decryptWith(BLOCK_KEY_VALUE, key.encryptedKeyValue).subarray(0, keyBytes);

  // 패키지는 4096바이트 단위로 나뉘고, 단위마다 IV = H(keyData 솔트 + 순번)
  const dataHash = hashOf(keyData.hashAlgorithm);
  const dataSalt = fromBase64(keyData.saltValue);
  const blockSize = Number(keyData.blockSize);
  const body = pkg.subarray(8);
  const out = new Uint8Array(body.length);
  let written = 0;
  for (let i = 0; i * SEGMENT < body.length; i++) {
    const segment = whole(body.subarray(i * SEGMENT, (i + 1) * SEGMENT));
    const iv = fit(dataHash(concat(dataSalt, le32(i))), blockSize);
    const plain = cbc(secretKey, iv, { disablePadding: true }).decrypt(segment);
    out.set(plain, written);
    written += plain.length;
  }
  return out.subarray(0, Math.min(written, packageSize(pkg)));
}

/**
 * 복합 문서에서 꺼낸 EncryptionInfo·EncryptedPackage 스트림으로 원래 .xlsx(zip) 내용을 되살린다.
 * 비밀번호가 틀리면 PasswordError.
 */
export function decryptOfficePackage(streams: Map<string, Uint8Array>, password: string): Uint8Array {
  const info = streams.get('EncryptionInfo');
  const pkg = streams.get('EncryptedPackage');
  if (!info || !pkg || info.length < 8 || pkg.length < 8) throw new Error('암호화된 엑셀 파일이 아닙니다.');
  const major = view(info).getUint16(0, true);
  const minor = view(info).getUint16(2, true);
  if (major === 4 && minor === 4) return decryptAgile(info, pkg, password);
  if (major >= 2 && major <= 4 && minor === 2) return decryptStandard(info, pkg, password);
  throw new Error('지원하지 않는 엑셀 암호화 방식입니다.');
}
