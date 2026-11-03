import { useMemo, useState } from 'react';
import type { CsvImportResult, Faq, FaqInput } from '../api/types';
import { useApi } from '../auth/session';
import FaqEditor from '../components/FaqEditor';
import { Badge, Button, Card, errorMessage, inputClass, Notice } from '../components/ui';
import { useAsync } from '../lib/useAsync';

const EMPTY: FaqInput = { category_code: 'usage', questions: [''], answer_text: '', status: 'draft' };
const SOURCE_LABEL: Record<Faq['source'], string> = { manual: '手入力', csv: 'CSV', unanswered: '未回答から' };

const CSV_SAMPLE = `category,question,answer
料金・請求,請求書の宛名を変えたい|宛名を変更したい,マイページの「契約者情報」から変更できます。
使い方,夜間も使えますか,24時間ご利用いただけます。`;

function CsvImport({ onDone, onCancel }: { onDone: (count: number) => void; onCancel: () => void }) {
  const api = useApi();
  const [csv, setCsv] = useState('');
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.importFaqs(csv, true));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    try {
      const r = await api.importFaqs(csv, false);
      onDone(r.imported);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError('ファイルが大きすぎます（512KB まで）');
      return;
    }
    setCsv(await file.text());
    setResult(null);
  }

  return (
    <Card title="CSV から取り込む">
      <div className="space-y-3 text-sm">
        <p className="text-[#475467]">
          列は <code className="font-mono text-xs bg-[#F2F4F7] px-1 rounded">category, question, answer</code>
          。質問の言い換えは「|」で区切ります。取り込んだ FAQ は<strong>下書き</strong>として登録されます。
        </p>
        <input type="file" accept=".csv,text/csv" onChange={(e) => void loadFile(e.target.files?.[0])} className="text-sm" />
        <textarea
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setResult(null);
          }}
          rows={6}
          placeholder={CSV_SAMPLE}
          className={`${inputClass} font-mono text-xs`}
        />
        {error && <Notice kind="error">{error}</Notice>}
        {result && (
          <div className="space-y-2">
            <Notice kind={result.errors.length ? 'error' : 'ok'}>
              {result.errors.length
                ? `${result.errors.length} 件のエラーがあります。直してからもう一度確認してください。`
                : `${result.valid} 件を取り込めます。`}
            </Notice>
            {result.errors.length > 0 && (
              <ul className="text-xs text-[#B42318] space-y-0.5">
                {result.errors.slice(0, 10).map((e) => (
                  <li key={e.row}>
                    {e.row} 行目：{e.message}
                  </li>
                ))}
              </ul>
            )}
            {result.errors.length === 0 && (
              <ul className="text-xs text-[#475467] space-y-1">
                {result.preview.map((p, i) => (
                  <li key={i} className="truncate">
                    ・{p.questions.join(' / ')} → {p.answer_text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setCsv(CSV_SAMPLE)} disabled={busy}>
            サンプルを入れる
          </Button>
          <Button variant="secondary" onClick={check} disabled={!csv.trim() || busy}>
            内容を確認
          </Button>
          <Button onClick={commit} disabled={!result || result.errors.length > 0 || result.valid === 0 || busy}>
            {result?.valid ?? 0} 件を下書きとして取り込む
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            閉じる
          </Button>
        </div>
      </div>
    </Card>
  );
}

export default function FaqManager() {
  const api = useApi();
  const [reload, setReload] = useState(0);
  const faqs = useAsync(() => api.faqs(), [api, reload]);
  const categories = useAsync(() => api.categories(), [api]);
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Faq | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const refresh = (text?: string) => {
    setReload((n) => n + 1);
    if (text) setMessage({ kind: 'ok', text });
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (faqs.data ?? []).filter(
      (f) =>
        (filter === 'all' || f.status === filter) &&
        (!q || [...f.questions, f.answer_text].some((t) => t.toLowerCase().includes(q))),
    );
  }, [faqs.data, filter, query]);

  const counts = {
    all: faqs.data?.length ?? 0,
    published: faqs.data?.filter((f) => f.status === 'published').length ?? 0,
    draft: faqs.data?.filter((f) => f.status === 'draft').length ?? 0,
  };

  async function act(fn: () => Promise<unknown>, ok: string) {
    try {
      await fn();
      refresh(ok);
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) });
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-8 py-6">
      <div className="max-w-5xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display font-semibold text-lg">FAQ管理</h2>
            <p className="text-sm text-[#667085] mt-1">公開した FAQ を、AI の回答とオペレーターの検索に使います。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setImporting(true)}>
              CSV 取り込み
            </Button>
            <Button onClick={() => setEditing('new')}>＋ FAQ を追加</Button>
          </div>
        </div>

        {message && <Notice kind={message.kind}>{message.text}</Notice>}

        {importing && (
          <CsvImport
            onCancel={() => setImporting(false)}
            onDone={(n) => {
              setImporting(false);
              refresh(`${n} 件の FAQ を下書きとして取り込みました。内容を確認して公開してください。`);
            }}
          />
        )}

        {editing && categories.data && (
          <Card title={editing === 'new' ? 'FAQ を追加' : 'FAQ を編集'}>
            <FaqEditor
              categories={categories.data}
              initial={editing === 'new' ? EMPTY : editing}
              submitLabel="保存"
              onCancel={() => setEditing(null)}
              onSubmit={async (input) => {
                if (editing === 'new') await api.createFaq(input);
                else await api.updateFaq(editing.faq_id, input);
                setEditing(null);
                refresh('FAQ を保存しました');
              }}
            />
          </Card>
        )}

        <Card>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {(['all', 'published', 'draft'] as const).map((k) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`text-xs px-2.5 py-1 rounded-md ${filter === k ? 'bg-[#1A2332] text-white' : 'text-[#667085] hover:bg-[#F0F1F3]'}`}
              >
                {{ all: 'すべて', published: '公開中', draft: '下書き' }[k]}（{counts[k]}）
              </button>
            ))}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="質問・回答で絞り込み"
              className={`${inputClass} sm:ml-auto sm:max-w-xs`}
            />
          </div>

          {faqs.loading && <p className="text-sm text-[#98A2B3] py-6 text-center">読み込み中…</p>}
          {faqs.error && <Notice kind="error">{faqs.error.message}</Notice>}
          {!faqs.loading && !shown.length && <p className="text-sm text-[#98A2B3] py-6 text-center">該当する FAQ はありません</p>}

          <ul className="divide-y divide-[#F0F1F3]">
            {shown.map((f) => (
              <li key={f.faq_id} className="py-4 flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge tone={f.status === 'published' ? 'green' : 'amber'}>{f.status === 'published' ? '公開中' : '下書き'}</Badge>
                    <Badge tone="gray">{f.category_name}</Badge>
                    {f.source !== 'manual' && <Badge tone="blue">{SOURCE_LABEL[f.source]}</Badge>}
                  </div>
                  <p className="font-medium text-sm">{f.questions[0]}</p>
                  {f.questions.length > 1 && (
                    <p className="text-xs text-[#98A2B3] mt-0.5">ほか {f.questions.slice(1).join(' / ')}</p>
                  )}
                  <p className="text-sm text-[#475467] mt-1.5">{f.answer_text}</p>
                  <p className="text-[11px] font-mono text-[#98A2B3] mt-1.5">更新 {f.updated_at.slice(0, 16).replace('T', ' ')}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="secondary" onClick={() => setEditing(f)}>
                    編集
                  </Button>
                  <Button
                    variant={f.status === 'published' ? 'secondary' : 'primary'}
                    onClick={() =>
                      act(
                        () => api.setFaqStatus(f.faq_id, f.status === 'published' ? 'draft' : 'published'),
                        f.status === 'published' ? '下書きに戻しました' : '公開しました',
                      )
                    }
                  >
                    {f.status === 'published' ? '非公開にする' : '公開する'}
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (window.confirm('この FAQ を削除しますか？')) void act(() => api.deleteFaq(f.faq_id), '削除しました');
                    }}
                  >
                    削除
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
