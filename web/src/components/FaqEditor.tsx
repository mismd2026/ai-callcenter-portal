import { useState } from 'react';
import type { Category, FaqInput } from '../api/types';
import { Button, Field, inputClass, Notice } from './ui';

/** FAQ の編集フォーム（新規作成・編集・未回答質問からの登録で共通） */
export default function FaqEditor({
  categories,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  categories: Category[];
  initial: FaqInput;
  submitLabel: string;
  onSubmit: (input: FaqInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FaqInput>({ ...initial, questions: initial.questions.length ? initial.questions : [''] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setQuestion = (i: number, value: string) =>
    setForm((f) => ({ ...f, questions: f.questions.map((q, j) => (j === i ? value : q)) }));
  const valid = form.questions.some((q) => q.trim()) && form.answer_text.trim();

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...form, questions: form.questions.map((q) => q.trim()).filter(Boolean) });
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存できませんでした');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="問い合わせ種別">
        <select
          value={form.category_code}
          onChange={(e) => setForm({ ...form, category_code: e.target.value })}
          className={inputClass}
        >
          {categories.map((c) => (
            <option key={c.category_code} value={c.category_code}>
              {c.category_name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="質問" hint="お客様の言い方の違いを複数登録すると、AI が見つけやすくなります">
        <div className="space-y-2">
          {form.questions.map((q, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={q}
                maxLength={300}
                onChange={(e) => setQuestion(i, e.target.value)}
                placeholder={i === 0 ? '例：解約の手続きを教えてください' : '言い換え'}
                className={inputClass}
              />
              {form.questions.length > 1 && (
                <Button
                  variant="ghost"
                  type="button"
                  aria-label="この質問を削除"
                  onClick={() => setForm((f) => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }))}
                >
                  ✕
                </Button>
              )}
            </div>
          ))}
          {form.questions.length < 20 && (
            <Button
              variant="ghost"
              type="button"
              className="!px-0 text-[#0F9B8E]"
              onClick={() => setForm((f) => ({ ...f, questions: [...f.questions, ''] }))}
            >
              ＋ 言い換えを追加
            </Button>
          )}
        </div>
      </Field>

      <Field label="回答" hint="AI がこのまま読み上げる場合があります。話し言葉で書いてください">
        <textarea
          value={form.answer_text}
          maxLength={2000}
          rows={4}
          onChange={(e) => setForm({ ...form, answer_text: e.target.value })}
          className={inputClass}
        />
      </Field>

      <Field label="公開状態">
        <div className="flex gap-4 text-sm">
          {(['draft', 'published'] as const).map((st) => (
            <label key={st} className="flex items-center gap-2">
              <input type="radio" checked={form.status === st} onChange={() => setForm({ ...form, status: st })} />
              {st === 'draft' ? '下書き（AI はまだ使わない）' : '公開（AI の回答に使う）'}
            </label>
          ))}
        </div>
      </Field>

      {error && <Notice kind="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button onClick={submit} disabled={!valid || busy}>
          {busy ? '保存中…' : submitLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          キャンセル
        </Button>
      </div>
    </div>
  );
}
