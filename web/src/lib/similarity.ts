// FAQ 検索の類似度。API（api/app/similarity.py）と同じ計算（文字バイグラムの Dice 係数）。

const PUNCT = /[\s、。，．,.!?！？「」『』（）()・〜~]+/g;

export function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(PUNCT, '');
}

export function bigrams(text: string): Set<string> {
  const t = normalize(text);
  if (t.length < 2) return new Set(t ? [t] : []);
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function score(query: string, candidate: string): number {
  const q = bigrams(query);
  const c = bigrams(candidate);
  if (!q.size || !c.size) return 0;
  let common = 0;
  for (const b of q) if (c.has(b)) common++;
  return (2 * common) / (q.size + c.size);
}
