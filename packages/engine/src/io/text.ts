/** 은행·카드사 파일은 EUC-KR(CP949)로 저장된 경우가 많다. UTF-8로 안 읽히면 EUC-KR로 읽는다. */
export function decodeText(buf: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}
