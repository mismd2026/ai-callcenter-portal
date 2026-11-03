import { describe, expect, it } from 'vitest';
import { applyCredits } from './credits';
import { score } from './similarity';

// api/tests/test_calls_and_credits.py::test_apply_credits_rules と同じケース
describe('クレジットの相殺（API と同じ規則）', () => {
  const usage = { '2026-05': 30000, '2026-06': 30000, '2026-07': 30000 };

  it('古い月から順に使う', () => {
    const credits = [{ amount: 50000, granted_at: '2026-05-01', expires_at: null }];
    expect(applyCredits(credits, usage, '2026-05').applied).toBe(30000);
    expect(applyCredits(credits, usage, '2026-06').applied).toBe(20000);
    expect(applyCredits(credits, usage, '2026-07')).toEqual({ applied: 0, balance: 0 });
  });

  it('付与月より前・期限切れの月には使わず、期限の近いものから使う', () => {
    const credits = [
      { amount: 10000, granted_at: '2026-06-15', expires_at: '2026-06-30' },
      { amount: 10000, granted_at: '2026-06-01', expires_at: null },
    ];
    expect(applyCredits(credits, usage, '2026-05').applied).toBe(0);
    expect(applyCredits(credits, usage, '2026-06')).toEqual({ applied: 20000, balance: 0 });
    const expiring = [{ amount: 40000, granted_at: '2026-06-01', expires_at: '2026-06-30' }];
    expect(applyCredits(expiring, usage, '2026-07')).toEqual({ applied: 0, balance: 0 });
  });
});

describe('FAQ 検索の類似度', () => {
  it('近い質問ほど高い', () => {
    const q = '領収書を発行したい';
    expect(score(q, '領収書は発行できますか')).toBeGreaterThan(score(q, '請求書を再発行してほしいです'));
  });
  it('全角・半角や記号の違いは無視する', () => {
    expect(score('ＡＰＩの上限は？', 'APIの上限は')).toBe(1);
  });
});
