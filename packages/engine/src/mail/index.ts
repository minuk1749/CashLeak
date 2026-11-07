// 메일함 연결 (Node.js 전용: 서버 API와 명령줄에서만 쓴다). 브라우저 코드는 '@cashleak/engine'만 가져온다.
export { fetchReceiptMail, IMAP_SERVERS, MailFetchError, type FetchMailOptions, type FetchMailResult, type ImapClient, type MailProblem } from './imap.ts';
export { gmailQuery, isAdvertisement, mightBeReceipt } from './filter.ts';
export { MAX_TEXT_LENGTH, readRawEmail } from './mime.ts';
