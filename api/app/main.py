"""顧客ポータル API。

- 顧客向け（/api/company/...）：ログインしたユーザーの所属会社のデータだけを扱う
    - ダッシュボード（routes/dashboard.py）：契約管理者・閲覧者
    - CMS（routes/cms.py）：契約管理者が FAQ・未回答質問・応答設定を編集
    - 通話入力（routes/calls.py）：契約管理者・オペレーター
- 運用管理者向け（/api/ops/...、routes/ops.py）：全テナントの閲覧とクレジットの付与
- 画面（React のビルド結果）も同じオリジンから配信するので、CORS は許可しない
"""

import logging
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .auth import Principal, build_verifier, get_principal
from .config import Settings
from .routes import calls, cms, dashboard, ops
from .seed import seed_if_empty

log = logging.getLogger("portal")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Content-Security-Policy": (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' data:; "
        "connect-src 'self' https://identitytoolkit.googleapis.com "
        "https://securetoken.googleapis.com; "
        "frame-ancestors 'none'"
    ),
}


def create_app(settings: Settings | None = None, verifier=None) -> FastAPI:
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.seed_demo_data:
            if seed_if_empty(app.state.engine, settings.fixture_path):
                log.info("demo data seeded")
        else:
            db.metadata.create_all(app.state.engine)
        yield

    app = FastAPI(
        title="AI Call Center Portal API", lifespan=lifespan, docs_url=None, redoc_url=None
    )
    app.state.engine = db.make_engine(settings.database_url)
    app.state.verifier = verifier or build_verifier(
        settings.auth_mode, settings.firebase_project_id, settings.running_on_cloud_run
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        return {"status": "ok"}

    @app.get("/api/config")
    def public_config():
        """画面が Firebase に接続するための公開設定（秘密情報ではない）。"""
        return {
            "auth_mode": settings.auth_mode,
            "firebase": {
                "apiKey": settings.firebase_api_key,
                "authDomain": settings.firebase_auth_domain,
                "projectId": settings.firebase_project_id,
            },
        }

    @app.get("/api/me")
    def me(p: Annotated[Principal, Depends(get_principal)]):
        return {"uid": p.uid, "email": p.email, "role": p.role, "company_code": p.company_code}

    for module in (dashboard, cms, calls, ops):
        app.include_router(module.router)

    # ---- 画面（React のビルド結果）の配信 ----
    if settings.static_dir and settings.static_dir.is_dir():
        static_dir = settings.static_dir
        app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(status.HTTP_404_NOT_FOUND)
            candidate = (static_dir / path).resolve()
            if path and candidate.is_file() and static_dir.resolve() in candidate.parents:
                return FileResponse(candidate)
            return FileResponse(static_dir / "index.html")

    return app
