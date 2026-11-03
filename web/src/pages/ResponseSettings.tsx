import { useEffect, useState } from 'react';
import type { ResponseSettings } from '../api/types';
import { useApi } from '../auth/session';
import { Button, Card, errorMessage, Field, inputClass, Notice } from '../components/ui';
import { useAsync } from '../lib/useAsync';

const DAYS = ['月', '火', '水', '木', '金', '土', '日'];

export default function ResponseSettingsPage() {
  const api = useApi();
  const loaded = useAsync(() => api.settings(), [api]);
  const [form, setForm] = useState<ResponseSettings | null>(null);
  const [keywords, setKeywords] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (loaded.data) {
      setForm(loaded.data);
      setKeywords(loaded.data.escalation_keywords.join('、'));
    }
  }, [loaded.data]);

  if (loaded.loading) return <p className="text-sm text-[#98A2B3] p-8">読み込み中…</p>;
  if (loaded.error || !form) return <div className="p-8"><Notice kind="error">{loaded.error?.message ?? '読み込めませんでした'}</Notice></div>;

  const toggleDay = (d: number) =>
    setForm({
      ...form,
      business_days: form.business_days.includes(d) ? form.business_days.filter((x) => x !== d) : [...form.business_days, d].sort(),
    });

  async function save() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const saved = await api.saveSettings({
        ...form,
        escalation_keywords: keywords.split(/[、,\n]/).map((k) => k.trim()).filter(Boolean),
      });
      setForm(saved);
      setKeywords(saved.escalation_keywords.join('、'));
      setMessage({ kind: 'ok', text: '応答設定を保存しました。次の通話から反映されます。' });
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-8 py-6">
      <div className="max-w-3xl space-y-6">
        <div>
          <h2 className="font-display font-semibold text-lg">応答設定</h2>
          <p className="text-sm text-[#667085] mt-1">AI が電話に出たときの案内と、オペレーターに切り替える条件です。</p>
        </div>

        <Card title="案内">
          <div className="space-y-4">
            <Field label="最初の挨拶">
              <textarea rows={2} maxLength={300} value={form.greeting} onChange={(e) => setForm({ ...form, greeting: e.target.value })} className={inputClass} />
            </Field>
            <Field label="営業時間外の案内">
              <textarea
                rows={2}
                maxLength={300}
                value={form.after_hours_message}
                onChange={(e) => setForm({ ...form, after_hours_message: e.target.value })}
                className={inputClass}
              />
            </Field>
          </div>
        </Card>

        <Card title="営業時間">
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="開始">
                <input type="time" value={form.business_hours_start} onChange={(e) => setForm({ ...form, business_hours_start: e.target.value })} className={inputClass} />
              </Field>
              <span className="pb-2 text-[#98A2B3]">〜</span>
              <Field label="終了">
                <input type="time" value={form.business_hours_end} onChange={(e) => setForm({ ...form, business_hours_end: e.target.value })} className={inputClass} />
              </Field>
            </div>
            <Field label="営業日">
              <div className="flex flex-wrap gap-2">
                {DAYS.map((label, i) => {
                  const d = i + 1;
                  const on = form.business_days.includes(d);
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      aria-pressed={on}
                      className={`w-10 h-10 rounded-lg text-sm border ${on ? 'bg-[#0F9B8E] text-white border-[#0F9B8E]' : 'bg-white text-[#475467] border-[#D0D5DD]'}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </Card>

        <Card title="オペレーターへの切り替え">
          <div className="space-y-4">
            <Field label="すぐに人に代わるキーワード" hint="「、」で区切って入力します。お客様がこの言葉を言ったら、AI は回答せずにオペレーターへつなぎます">
              <textarea rows={2} value={keywords} onChange={(e) => setKeywords(e.target.value)} className={inputClass} />
            </Field>
            <Field label="AI が対応する最大のやり取り回数" hint="この回数で解決しなければオペレーターへつなぎます">
              <input
                type="number"
                min={1}
                max={10}
                value={form.max_ai_turns}
                onChange={(e) => setForm({ ...form, max_ai_turns: Number(e.target.value) })}
                className={`${inputClass} max-w-[120px]`}
              />
            </Field>
          </div>
        </Card>

        {message && <Notice kind={message.kind}>{message.text}</Notice>}
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </Button>
          {form.updated_at && <span className="text-xs font-mono text-[#98A2B3]">最終更新 {form.updated_at.slice(0, 16).replace('T', ' ')}</span>}
        </div>
      </div>
    </div>
  );
}
