from __future__ import annotations

import os
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.auth import InsecureDevVerifier
from app.config import REPO_ROOT, Settings
from app.db import make_engine, metadata
from app.main import create_app
from app.seed import seed_if_empty


@pytest.fixture()
def client(tmp_path):
    # TEST_DATABASE_URL を指定すると PostgreSQL でも同じテストを流せる（CI で使用）
    url = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{tmp_path / 'test.db'}"
    if url.startswith("postgresql"):
        engine = make_engine(url)
        metadata.drop_all(engine)
        engine.dispose()
    settings = Settings(
        database_url=url,
        auth_mode="insecure-dev",
        seed_demo_data=False,
        fixture_path=REPO_ROOT / "fixtures" / "demo.json",
        static_dir=None,
        running_on_cloud_run=False,
    )
    app = create_app(settings, verifier=InsecureDevVerifier())
    seed_if_empty(app.state.engine, settings.fixture_path, now=datetime.now())
    with TestClient(app) as c:
        yield c


def auth(role: str, company: str = "") -> dict:
    return {"Authorization": f"Bearer dev:{role}:{company}"}
