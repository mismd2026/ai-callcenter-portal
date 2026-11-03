import { useEffect, useState } from 'react';
import type { CallOutcome, Faq, ManualCallInput } from '../api/types';
import { useApi } from '../auth/session';
import { Badge, Button, Card, errorMessage, Field, inputClass, Notice } from '../components/ui';
import { formatMoney } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const OUTCOMES: { key: CallOutcome; label: string; hint: string }[] = [
  { key: 'resolved', label: '解決', hint: 'この通話で完了' },
  { key: 'escalated', label: '引き継ぎ', hint: '担当部署へ回す' },
  { key: 'callback', label: '折り返し', hint: 'あとで連絡する' },
];

const EMPTY: ManualCallInput = {
  category_code: 'usage',
  caller_question: '',
  answer_given: '',
  faq_id: null,
  outcome: 'resolved',
  duration_minutes: 3,
  note: null,
  not_in_faq: false,
};

export default function CallEntry() {
  const api = useApi();
  const categories = useAsync(() => api.categories(), [api]);
  const company = useAsync(() => api.company(), [api]);
  const [reload, setReload] = useState(0);
  const recent = useAsync(() => api.manualCalls(), [api, reload]);
  const [form, setForm] = useState<ManualCallInput>(EMPTY);
  const [hits, setHits] = useState<Faq[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // 入力中の質問から FAQ の候補を探す（少し待ってから検索）
  useEffect(() => {
    const q = form.caller_question.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const timer = setTimeout(() => {
      api.searchFaqs(q).then(setHits, () => setHits([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [api, form.caller_question]);

  const applyFaq = (f: Faq) =>
    setForm((prev) => ({ ...prev, faq_id: f.faq_id, answer_given: f.answer_text, category_code: f.category_code, not_in_faq: false }));

  const valid = form.caller_question.trim() && form.answer_given.trim() && form.duration_minutes >= 1;

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.createManualCall(form);
      setMessage({
        kind: 'ok',
        text: r.case_id ? `記録しました。対応履歴に ${r.case_id} として登録しました。` : '記録しました。',
      });
      setForm(EMPTY);
      setHits([]);
      setReload((n) => n + 1);
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-8 py-6">
      <div className="max-w-5xl grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          <div>
            <h2 className="font-display font-semibold text-lg">通話入力</h2>
            <p className="text-sm text-[#667085] mt-1">
              人が受けた電話の内容を記録します。導入前の手動テストにも使えます。記録した通話は利用状況に含まれます。
              {company.data?.billing_model === 'metered' && company.data.per_call_fee
                ? `従量課金オプションのため、1通話あたり ${formatMoney(company.data.per_call_fee)} の通話処理料がかかり、導入支援クレジットと相殺されます。`
                : '月額定額のプランのため、通話ごとの料金はかかりません。'}
            </p>
          </div>

          <Card>
            <div className="space-y-4">
              <Field label="お問い合わせ内容">
                <textarea
                  rows={3}
                  maxLength={1000}
                  value={form.caller_question}
                  onChange={(e) => setForm({ ...form, caller_question: e.target.value, faq_id: null })}
                  placeholder="お客様が話した内容を入力すると、下に FAQ の候補が出ます"
                  className={inputClass}
                />
              </Field>

              {hits.length > 0 && (
                <div className="rounded-xl border border-[#E4E7EC] bg-[#F9FAFB] p-3">
                  <p className="text-xs text-[#667085] mb-2">FAQ の候補（クリックで回答に使う）</p>
                  <ul className="space-y-2">
                    {hits.map((f) => (
                      <li key={f.faq_id}>
                        <button
                          type="button"
                          onClick={() => applyFaq(f)}
                          className={`w-full text-left rounded-lg border px-3 py-2 text-sm bg-white hover:border-[#0F9B8E]/60 ${
                            form.faq_id === f.faq_id ? 'border-[#0F9B8E]' : 'border-[#E4E7EC]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{f.questions[0]}</span>
                            <span className="text-[11px] font-mono text-[#98A2B3]">一致度 {Math.round((f.score ?? 0) * 100)}%</span>
                          </div>
                          <p className="text-xs text-[#475467] mt-1 line-clamp-2">{f.answer_text}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Field label="回答した内容">
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={form.answer_given}
                  onChange={(e) => setForm({ ...form, answer_given: e.target.value })}
                  className={inputClass}
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="問い合わせ種別">
                  <select value={form.category_code} onChange={(e) => setForm({ ...form, category_code: e.target.value })} className={inputClass}>
                    {(categories.data ?? []).map((c) => (
                      <option key={c.category_code} value={c.category_code}>
                        {c.category_name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="通話時間（分）">
                  <input
                    type="number"
                    min={1}
                    max={240}
                    value={form.duration_minutes}
                    onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Field label="結果">
                <div className="grid grid-cols-3 gap-2">
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => setForm({ ...form, outcome: o.key })}
                      aria-pressed={form.outcome === o.key}
                      className={`rounded-lg border px-3 py-2 text-left ${
                        form.outcome === o.key ? 'border-[#0F9B8E] bg-[#0F9B8E]/5' : 'border-[#D0D5DD] bg-white'
                      }`}
                    >
                      <div className="text-sm font-medium">{o.label}</div>
                      <div className="text-[11px] text-[#98A2B3]">{o.hint}</div>
                    </button>
                  ))}
                </div>
              </Field>

              {form.outcome !== 'resolved' && (
                <Field label="引き継ぎメモ" hint="対応履歴に載ります">
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={form.note ?? ''}
                    onChange={(e) => setForm({ ...form, note: e.target.value || null })}
                    className={inputClass}
                  />
                </Field>
              )}

              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.not_in_faq}
                  onChange={(e) => setForm({ ...form, not_in_faq: e.target.checked })}
                  className="mt-0.5"
                />
                <span>
                  FAQ に答えがなかった
                  <span className="block text-xs text-[#98A2B3]">契約管理者の「未回答レビュー」に回り、FAQ に追加できます</span>
                </span>
              </label>

              {message && <Notice kind={message.kind}>{message.text}</Notice>}
              <Button onClick={submit} disabled={!valid || busy} className="w-full sm:w-auto">
                {busy ? '記録中…' : '通話を記録'}
              </Button>
            </div>
          </Card>
        </div>

        <aside>
          <Card title="最近の入力">
            {recent.data && !recent.data.length && <p className="text-sm text-[#98A2B3]">まだ入力はありません</p>}
            <ul className="space-y-3">
              {(recent.data ?? []).slice(0, 10).map((c) => (
                <li key={c.call_id} className="text-sm border-b border-[#F0F1F3] pb-3 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-[#98A2B3]">{c.started_at.slice(5, 16).replace('T', ' ')}</span>
                    <Badge tone={c.outcome === 'resolved' ? 'green' : 'amber'}>
                      {OUTCOMES.find((o) => o.key === c.outcome)?.label}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2">{c.caller_question}</p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
