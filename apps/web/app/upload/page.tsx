'use client';

import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { guessInstitution } from '@cashleak/engine';
import { useData } from '@/lib/data-context';
import { decodeText, guessFile, INSTITUTIONS, KIND_LABEL, parseFile, type FileInput, type ParsedFile } from '@/lib/files';
import type { FileKind } from '@/lib/store/types';
import { formatDate } from '@/lib/format';
import { uuid } from '@/lib/ids';
import { Badge, Button, buttonClass, Card, ErrorBox, Loading, PageHeader, SectionTitle } from '@/components/ui';
import { DemoButton } from '@/components/demo-button';

interface Pending {
  key: string;
  name: string;
  text: string;
  kind: FileKind | '';
  institution: string;
  problem?: string;
}

const KINDS: FileKind[] = ['bank', 'card', 'pay', 'email'];

const period = (first?: string, last?: string) =>
  first && last ? `${formatDate(first, { year: true, weekday: false })} ~ ${formatDate(last, { weekday: false })}` : '';

/** 26.5.1 ~ 10.26 */
const shortPeriod = (first?: string, last?: string) => {
  if (!first || !last) return '';
  const [y, m, d] = first.split('-').map(Number);
  const [, m2, d2] = last.split('-').map(Number);
  return `${String(y).slice(2)}.${m}.${d} ~ ${m2}.${d2}`;
};

export default function UploadPage() {
  const data = useData();
  const { status, snapshot, mode, userEmail } = data;
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [results, setResults] = useState<ParsedFile[] | null>(null);
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  const existing = useMemo(
    () => new Set([...snapshot.transactions.map((t) => t.fingerprint), ...snapshot.emails.map((m) => m.fingerprint)]),
    [snapshot],
  );

  // 올리기 전에 미리 읽어서 몇 줄인지, 이미 올린 내역과 몇 줄 겹치는지 보여 준다.
  const previews = useMemo(
    () =>
      pending.map((p) => {
        if (p.problem && !p.kind) return { error: p.problem };
        if (!p.kind) return { error: '종류를 골라 주세요.' };
        try {
          return { parsed: parseFile({ name: p.name, text: p.text, kind: p.kind, institution: p.institution }, existing, 'preview') };
        } catch (e) {
          return { error: (e as Error).message };
        }
      }),
    [pending, existing],
  );
  const ready = pending.filter((_, i) => previews[i].parsed && previews[i].parsed!.upload.count > 0);

  if (status === 'loading') return <Loading />;

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = '';
    setResults(null);
    const next = await Promise.all(
      files.map(async (file): Promise<Pending> => {
        const binary = /\.(xlsx?|pdf|hwp)$/i.test(file.name);
        const text = binary ? '' : decodeText(await file.arrayBuffer());
        const guess = guessFile(file.name, text);
        return { key: uuid(), name: file.name, text, kind: guess.kind ?? '', institution: guess.institution, problem: guess.problem };
      }),
    );
    setPending((list) => [...list, ...next]);
  }

  function update(key: string, patch: Partial<Pending>) {
    setPending((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function changeKind(p: Pending, kind: FileKind | '') {
    const keep = kind && INSTITUTIONS[kind].includes(p.institution);
    const institution = !kind || keep ? p.institution : kind === 'email' ? 'Gmail' : guessInstitution(p.name, kind);
    update(p.key, { kind, institution });
  }

  async function submit() {
    setWorking(true);
    setError(undefined);
    try {
      const files: FileInput[] = ready.map((p) => ({ name: p.name, text: p.text, kind: p.kind as FileKind, institution: p.institution.trim() || KIND_LABEL[p.kind as FileKind] }));
      setResults(await data.addFiles(files));
      setPending([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`${name} 파일로 올린 내역을 지울까요?`)) return;
    try {
      await data.removeUpload(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function clearAll() {
    if (!confirm('올린 내역과 직접 고친 내용을 모두 지울까요? 되돌릴 수 없어요.')) return;
    try {
      await data.clearAll();
      setResults(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="내역 올리기" />
      <div className="px-4">
        <Card>
          <p className="leading-relaxed">
            통장·카드·간편결제 거래내역 파일을 한꺼번에 골라 주세요. 여러 내역을 서로 맞춰서 같은 결제는 하나로 합치고, 돈이 어떤 경로로 나갔는지 찾아요.
          </p>
          <input ref={inputRef} type="file" multiple accept=".csv,.json,.txt,.xls,.xlsx,text/csv,application/json" onChange={pick} className="hidden" />
          <Button className="mt-4 w-full" onClick={() => inputRef.current?.click()}>
            파일 고르기
          </Button>
          <p className="mt-2 text-xs leading-relaxed text-faint">
            CSV 파일을 읽어요 (UTF-8, EUC-KR 모두 가능). 엑셀은 &ldquo;CSV&rdquo;로 저장해서 올려 주세요.{' '}
            {mode === 'local' ? '파일은 이 브라우저 안에서만 읽고 저장해요.' : '읽은 내역은 내 계정에만 저장돼요.'}
          </p>
        </Card>

        {pending.length > 0 && (
          <>
            <SectionTitle count={pending.length}>올릴 파일 확인</SectionTitle>
            <div className="space-y-2">
              {pending.map((p, i) => {
                const preview = previews[i];
                return (
                  <Card key={p.key}>
                    <div className="flex items-start gap-2">
                      <p className="min-w-0 flex-1 break-all font-medium">{p.name}</p>
                      <button type="button" aria-label={`${p.name} 빼기`} onClick={() => setPending((list) => list.filter((x) => x.key !== p.key))} className="-mr-1 -mt-1 rounded-full px-2 py-1 text-faint active:bg-line">
                        ✕
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-sm">
                      <label htmlFor={`kind-${p.key}`} className="text-sub">종류</label>
                      <select id={`kind-${p.key}`} value={p.kind} onChange={(e) => changeKind(p, e.target.value as FileKind | '')} className="h-10 rounded-lg bg-bg px-2">
                        <option value="">골라 주세요</option>
                        {KINDS.map((k) => (
                          <option key={k} value={k}>
                            {k === 'email' ? '메일 (가상 데이터 형식)' : `${KIND_LABEL[k]} 내역`}
                          </option>
                        ))}
                      </select>
                      <label htmlFor={`inst-${p.key}`} className="text-sub">기관</label>
                      <input
                        id={`inst-${p.key}`}
                        list={p.kind ? `inst-list-${p.kind}` : undefined}
                        value={p.institution}
                        onChange={(e) => update(p.key, { institution: e.target.value })}
                        placeholder="예: 농협은행"
                        className="h-10 min-w-0 rounded-lg bg-bg px-2"
                      />
                    </div>
                    {preview.error ? (
                      <p className="mt-3 text-sm text-danger">{preview.error}</p>
                    ) : (
                      <p className="mt-3 text-sm text-sub">
                        {preview.parsed!.total}줄 · {period(preview.parsed!.upload.firstDate, preview.parsed!.upload.lastDate) || '기간 없음'}
                        {preview.parsed!.skipped > 0 && ` · 거래가 아닌 ${preview.parsed!.skipped}줄 건너뜀`}
                        {preview.parsed!.upload.count === 0
                          ? ' · 이미 올린 내역이라 새로 추가할 줄이 없어요'
                          : preview.parsed!.duplicates > 0 && ` · 이미 올린 ${preview.parsed!.duplicates}줄은 빼고 추가`}
                      </p>
                    )}
                  </Card>
                );
              })}
            </div>
            {KINDS.map((k) => (
              <datalist key={k} id={`inst-list-${k}`}>
                {INSTITUTIONS[k].map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            ))}
            {error && <div className="mt-3"><ErrorBox>{error}</ErrorBox></div>}
            <Button className="mt-3 w-full" disabled={working || ready.length === 0} onClick={submit}>
              {working ? '분석하는 중…' : ready.length ? `${ready.length}개 파일 추가하기` : '추가할 새 내역이 없어요'}
            </Button>
          </>
        )}

        {results && (
          <Card className="mt-4">
            <p className="font-semibold">추가했어요</p>
            <ul className="mt-2 space-y-1 text-sm text-sub">
              {results.map((r) => (
                <li key={r.upload.id}>
                  · {r.upload.name}: {r.upload.count}건{r.duplicates > 0 && ` (겹친 ${r.duplicates}건 제외)`}
                </li>
              ))}
            </ul>
            <Link href="/" className={buttonClass('primary', 'mt-4 w-full')}>
              찾은 구독 보기
            </Link>
          </Card>
        )}

        {snapshot.uploads.length > 0 && (
          <>
            <SectionTitle count={snapshot.uploads.length}>올린 파일</SectionTitle>
            <Card padded={false} className="divide-y divide-line">
              {snapshot.uploads.map((u) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{u.institution}</span>
                      <Badge>{KIND_LABEL[u.kind]}</Badge>
                    </p>
                    <p className="mt-0.5 truncate text-xs text-faint">
                      {u.name} · {u.count}건{u.firstDate && ` · ${shortPeriod(u.firstDate, u.lastDate)}`}
                    </p>
                  </div>
                  <button type="button" onClick={() => remove(u.id, u.name)} className="shrink-0 rounded-lg px-2 py-1 text-sm text-danger active:bg-danger-soft">
                    지우기
                  </button>
                </div>
              ))}
            </Card>
          </>
        )}

        <SectionTitle>가상 데이터로 체험</SectionTitle>
        <Card>
          <p className="text-sm leading-relaxed text-sub">
            농협 통장, 신한카드, 카카오페이·네이버페이 내역과 Gmail·네이버메일 영수증으로 만든 가상 사용자예요. 카카오페이로 낸 멜론이 농협 계좌에서 나간 것처럼 여러 경로가 들어 있어요.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            <DemoButton />
            <SampleDownloads />
          </div>
        </Card>

        <SectionTitle>어떤 파일을 올리나요?</SectionTitle>
        <Card className="text-sm leading-relaxed text-sub">
          <ul className="space-y-1.5">
            <li>· <b className="text-ink">통장</b>: 인터넷뱅킹 거래내역 조회에서 저장한 파일 (날짜, 금액, 내용 열이 있으면 돼요)</li>
            <li>· <b className="text-ink">카드</b>: 카드사 이용내역 (이용일자, 가맹점명, 이용금액)</li>
            <li>· <b className="text-ink">간편결제</b>: 카카오페이·네이버페이 결제내역 (결제수단 열이 있으면 어느 계좌·카드에서 나갔는지 맞춰요)</li>
          </ul>
          <p className="mt-3 text-xs text-faint">
            은행·카드사마다 열 이름이 달라서, 읽지 못하는 파일이 있으면 머리글(첫 줄)을 알려 주세요. 엑셀·PDF 형식은 실제 파일을 확인한 뒤 지원할 예정이에요.
          </p>
        </Card>

        <SectionTitle>저장 위치</SectionTitle>
        <Card className="space-y-3 text-sm">
          <p className="text-sub">
            {mode === 'local'
              ? '로그인 없이 이 브라우저에만 저장하고 있어요. 브라우저 데이터를 지우면 함께 지워져요.'
              : `${userEmail ?? '내'} 계정에 저장하고 있어요.`}
          </p>
          <div className="flex gap-2">
            {mode === 'cloud' && (
              <Button variant="secondary" className="flex-1" onClick={() => data.signOut()}>
                로그아웃
              </Button>
            )}
            <Button variant="danger" className="flex-1" onClick={clearAll} disabled={snapshot.uploads.length === 0 && snapshot.manual.length === 0}>
              모든 데이터 지우기
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function SampleDownloads() {
  const [files, setFiles] = useState<FileInput[] | null>(null);

  async function load() {
    const { sampleFiles } = await import('@/lib/demo');
    setFiles(sampleFiles());
  }

  function download(file: FileInput) {
    const type = file.name.endsWith('.json') ? 'application/json' : 'text/csv';
    const url = URL.createObjectURL(new Blob([file.text], { type: `${type};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!files) {
    return (
      <Button variant="ghost" onClick={load}>
        샘플 파일 내려받기
      </Button>
    );
  }
  return (
    <ul className="space-y-1 text-sm">
      {files.map((f) => (
        <li key={f.name} className="flex items-center justify-between gap-2">
          <span className="text-sub">
            {f.institution} · {f.name}
          </span>
          <button type="button" onClick={() => download(f)} className="font-medium text-accent">
            받기
          </button>
        </li>
      ))}
    </ul>
  );
}
