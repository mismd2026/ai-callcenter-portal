"""環境変数から設定を読み込む。"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import quote_plus

REPO_ROOT = Path(__file__).resolve().parents[2]


def _database_url() -> str:
    if url := os.environ.get("DATABASE_URL"):
        return url
    # Cloud Run では接続情報を個別の環境変数で受け取り、パスワードは Secret Manager から渡す
    if host := os.environ.get("DB_HOST"):
        user = os.environ.get("DB_USER", "portal")
        password = quote_plus(os.environ.get("DB_PASSWORD", ""))
        name = os.environ.get("DB_NAME", "portal")
        return f"postgresql+psycopg://{user}:{password}@{host}:5432/{name}"
    return "sqlite:///./portal.db"


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=_database_url)
    # firebase: Firebase の ID トークンを検証する（本番）
    # insecure-dev: "Bearer dev:<role>:<company_code>" をそのまま信じる（ローカル開発専用）
    auth_mode: str = field(default_factory=lambda: os.environ.get("AUTH_MODE", "firebase"))
    firebase_project_id: str = field(
        default_factory=lambda: os.environ.get("FIREBASE_PROJECT_ID", "")
    )
    # 画面が使う Firebase の Web 設定（公開して問題のない値）
    firebase_api_key: str = field(default_factory=lambda: os.environ.get("FIREBASE_API_KEY", ""))
    firebase_auth_domain: str = field(
        default_factory=lambda: os.environ.get("FIREBASE_AUTH_DOMAIN", "")
    )
    seed_demo_data: bool = field(
        default_factory=lambda: os.environ.get("SEED_DEMO_DATA", "false").lower() == "true"
    )
    fixture_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("FIXTURE_PATH", REPO_ROOT / "fixtures" / "demo.json")
        )
    )
    static_dir: Path | None = field(
        default_factory=lambda: Path(p) if (p := os.environ.get("STATIC_DIR")) else None
    )
    running_on_cloud_run: bool = field(default_factory=lambda: "K_SERVICE" in os.environ)
