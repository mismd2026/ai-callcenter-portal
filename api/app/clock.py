"""日時の扱い。

DB の日時は元の設計どおりタイムゾーンなしの ISO 文字列（現地時刻）で持つ。
Cloud Run のサーバーは UTC で動くので、「今」は必ずここから取る。
"""

from __future__ import annotations

import os
from datetime import datetime
from zoneinfo import ZoneInfo


def now_local() -> datetime:
    tz = ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Tokyo"))
    return datetime.now(tz).replace(tzinfo=None, microsecond=0)


def iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S")
