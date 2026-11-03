import { useState } from 'react';
import type { Unanswered, UnansweredStatus } from '../api/types';
import { useApi } from '../auth/session';
import FaqEditor from '../components/FaqEditor';
import { Badge, Button, Card, errorMessage, Notice } from '../components/ui';
import { useAsync } from '../lib/useAsync';

export default function UnansweredReview() {
  const api = useApi();
  const [status, setStatus] = useState<UnansweredStatus>('open');
  const [reload, setReload] = useState(0);
  const items = useAsync(() => api.unanswered(status), [api, status, reload]);
  const categories = useAsync(() => api.categories(), [api]);
  const [promoting, setPromoting] = useState<Unanswered | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const done = (text: string) => {
    setPromoting(null);
    setMessage({ kind: 'ok', text });
    setReload((n) => n + 1);
  };

  return (
    <div className="h-full overflow-y-auto px-4 sm:px-8 py-6">
      <div className="max-w-4xl space-y-6">
        <div>
          <h2 className="font-display font-semibold text-lg">未回答レビュー</h2>
          <p className="text-sm text-[#667085] mt-1">
            AI が答えられなかった質問と、オペレーターが「FAQ にない」として入力した質問です。FAQ に登録すると、次からは AI が答えられるようになります。
          </p>
        </div>

        {message && <Notice kind={message.kind}>{message.text}</Notice>}

        {promoting && categories.data && (
          <Card title="FAQ として登録">
            <p className="text-sm text-[#475467] mb-4">
              元の質問：<span className="font-medium">{promoting.question_text}</span>
            </p>
            <FaqEditor
              categories={categories.data}
              initial={{ category_code: 'other', questions: [promoting.question_text], answer_text: '', status: 'published' }}
              submitLabel="FAQ に登録"
              onCancel={() => setPromoting(null)}
              onSubmit={async (input) => {
                await api.promoteUnanswered(promoting.id, input);
                done('FAQ に登録しました');
              }}
            />
          </Card>
        )}

        <Card
          action={
            <div className="flex gap-1">
              {(['open', 'promoted', 'dismissed'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setStatus(k)}
                  className={`text-xs px-2.5 py-1 rounded-md ${status === k ? 'bg-[#1A2332] text-white' : 'text-[#667085] hover:bg-[#F0F1F3]'}`}
                >
                  {{ open: '未対応', promoted: 'FAQ に登録済み', dismissed: '対応不要' }[k]}
                </button>
              ))}
            </div>
          }
          title="質問一覧"
        >
          {items.loading && <p className="text-sm text-[#98A2B3] py-6 text-center">読み込み中…</p>}
          {items.error && <Notice kind="error">{items.error.message}</Notice>}
          {items.data && !items.data.length && <p className="text-sm text-[#98A2B3] py-6 text-center">該当する質問はありません</p>}
          <ul className="divide-y divide-[#F0F1F3]">
            {(items.data ?? []).map((u) => (
              <li key={u.id} className="py-3 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="text-sm font-medium">{u.question_text}</p>
                  <p className="text-[11px] font-mono text-[#98A2B3] mt-0.5">
                    {u.timestamp.slice(0, 16).replace('T', ' ')}
                    {u.reviewed_at && ` ・ レビュー ${u.reviewed_at.slice(0, 16).replace('T', ' ')}`}
                  </p>
                </div>
                {u.status === 'open' ? (
                  <div className="flex gap-2 shrink-0">
                    <Button onClick={() => setPromoting(u)}>FAQ に登録</Button>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await api.dismissUnanswered(u.id);
                          done('対応不要にしました');
                        } catch (e) {
                          setMessage({ kind: 'error', text: errorMessage(e) });
                        }
                      }}
                    >
                      対応不要
                    </Button>
                  </div>
                ) : (
                  <Badge tone={u.status === 'promoted' ? 'green' : 'gray'}>
                    {u.status === 'promoted' ? 'FAQ に登録済み' : '対応不要'}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
