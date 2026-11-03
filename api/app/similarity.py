"""通話入力画面の FAQ 検索に使う、文字の2文字組（バイグラム）による簡易な類似度。

本番の AI 応答は ai-callcenter-ollama の埋め込み検索（multilingual-e5）を使う。
ここはオペレーターが手元で候補を探すための軽い検索で、外部の AI は使わない。
Web のデモ版（web/src/lib/similarity.ts）も同じ計算をしている。
"""

from __future__ import annotations

import re
import unicodedata

_PUNCT = re.compile(r"[\s、。，．,.!?！？「」『』（）()・〜~]+")


def normalize(text: str) -> str:
    return _PUNCT.sub("", unicodedata.normalize("NFKC", text).lower())


def bigrams(text: str) -> set[str]:
    t = normalize(text)
    if len(t) < 2:
        return {t} if t else set()
    return {t[i : i + 2] for i in range(len(t) - 1)}


def score(query: str, candidate: str) -> float:
    """Dice 係数（0〜1）。共通するバイグラムが多く、長さが近いほど高い。"""
    q, c = bigrams(query), bigrams(candidate)
    if not q or not c:
        return 0.0
    return 2 * len(q & c) / (len(q) + len(c))
