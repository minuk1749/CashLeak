import { fetchReceiptMail } from '@cashleak/engine/mail';
import { createMailHandler } from '@/lib/mail-server';
import { todayKst } from '@/lib/format';

// 메일함에서 구독 영수증 메일을 가져오는 서버 API. 앱의 '내역 올리기' 화면에서 부른다.
// 메일 서버 접속에 시간이 걸릴 수 있어 최대 60초까지 기다린다.
export const maxDuration = 60;

export const POST = createMailHandler({ fetchMail: (options) => fetchReceiptMail(options), today: todayKst });
