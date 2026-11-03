"""クレジットの相殺計算（純粋な関数なので単体テストしやすい）。

- クレジットは従量料金（基本ライセンス料以外）とだけ相殺する
- 古い月から順に、期限の近いクレジットから使う
- 付与月より前の月、期限切れ後の月には使わない

Web のデモ版（web/src/lib/credits.ts）も同じ規則で計算している。
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Credit:
    amount: float
    granted_at: str  # YYYY-MM-DD
    expires_at: str | None  # YYYY-MM-DD


@dataclass(frozen=True)
class CreditResult:
    applied: float  # 対象月に相殺した額
    balance: float  # 対象月の終わり時点の残高（期限切れを除く）


def _usable(c: Credit, period: str) -> bool:
    start = f"{period}-01"
    return c.granted_at[:7] <= period and (c.expires_at is None or c.expires_at >= start)


def apply_credits(
    credits: list[Credit], usage_by_period: dict[str, float], period: str
) -> CreditResult:
    remaining = [[c, c.amount] for c in credits]
    order = sorted(remaining, key=lambda x: (x[0].expires_at or "9999-12-31", x[0].granted_at))
    applied_target = 0.0
    for p in sorted(set(usage_by_period) | {period}):
        if p > period:
            break
        due = usage_by_period.get(p, 0.0)
        applied = 0.0
        for item in order:
            if due <= 0:
                break
            credit, left = item
            if left <= 0 or not _usable(credit, p):
                continue
            use = min(left, due)
            item[1] -= use
            due -= use
            applied += use
        if p == period:
            applied_target = applied
    balance = sum(left for c, left in remaining if left > 0 and _usable(c, period))
    return CreditResult(applied=round(applied_target), balance=round(balance))
