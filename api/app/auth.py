"""認証と認可。

元の API は URL の会社コードを信じていたため、URL を書き換えるだけで他社のデータが見えた。
ここでは会社コードとロールを **Firebase の ID トークンのカスタムクレーム** から取り出し、
URL や画面からは一切受け取らない。

カスタムクレームの例（scripts/set_claims.py で設定する）:
    契約管理者:   {"role": "company_admin", "company_code": "ACME-TOKYO"}
    オペレーター: {"role": "operator",      "company_code": "ACME-TOKYO"}
    閲覧者:       {"role": "viewer",        "company_code": "ACME-TOKYO"}
    運用管理者:   {"role": "ops_admin"}

ロールとできること:
    company_admin  ダッシュボード、CMS（FAQ・未回答レビュー・応答設定）、通話入力、解約の申し込み
    operator       通話入力と FAQ の検索（ダッシュボードと CMS の編集は不可）
    viewer         ダッシュボードの閲覧のみ
    ops_admin      運用コンソール（全テナント）、クレジットの付与
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Protocol

from fastapi import Depends, HTTPException, Request, status

CUSTOMER_ROLES = {"company_admin", "operator", "viewer"}
OPS_ROLE = "ops_admin"


@dataclass(frozen=True)
class Principal:
    uid: str
    email: str | None
    role: str
    company_code: str | None


class TokenVerifier(Protocol):
    def verify(self, token: str) -> dict: ...


class FirebaseVerifier:
    """Firebase の ID トークンを検証する。Cloud Run ではサービスアカウントの権限で動く。"""

    def __init__(self, project_id: str) -> None:
        import firebase_admin
        from firebase_admin import auth

        if not firebase_admin._apps:
            options = {"projectId": project_id} if project_id else None
            firebase_admin.initialize_app(options=options)
        self._auth = auth

    def verify(self, token: str) -> dict:
        # check_revoked=True: 退職者などトークンを失効させたユーザーを即座に締め出す
        return self._auth.verify_id_token(token, check_revoked=True)


class InsecureDevVerifier:
    """ローカル開発専用。"dev:<role>:<company_code>" という文字列をそのまま信じる。"""

    def verify(self, token: str) -> dict:
        parts = token.split(":")
        if len(parts) < 2 or parts[0] != "dev":
            raise ValueError("invalid dev token")
        claims = {"uid": f"dev-{parts[1]}", "role": parts[1]}
        if len(parts) > 2 and parts[2]:
            claims["company_code"] = parts[2]
        return claims


def build_verifier(auth_mode: str, project_id: str, on_cloud_run: bool) -> TokenVerifier:
    if auth_mode == "insecure-dev":
        if on_cloud_run:
            raise RuntimeError("AUTH_MODE=insecure-dev は Cloud Run では使えません")
        return InsecureDevVerifier()
    if auth_mode == "firebase":
        return FirebaseVerifier(project_id)
    raise RuntimeError(f"unknown AUTH_MODE: {auth_mode}")


def _unauthorized() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, "認証が必要です", headers={"WWW-Authenticate": "Bearer"}
    )


def get_principal(request: Request) -> Principal:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise _unauthorized()
    try:
        claims = request.app.state.verifier.verify(token)
    except Exception as exc:  # 署名不正・期限切れ・失効など。理由は返さない
        raise _unauthorized() from exc

    role = claims.get("role")
    company_code = claims.get("company_code")
    if role == OPS_ROLE:
        company_code = None
    elif role not in CUSTOMER_ROLES or not company_code:
        # ログインはできても、ポータルの利用権限（クレーム）が付いていないユーザー
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ポータルの利用権限がありません")
    return Principal(
        uid=claims.get("uid") or claims.get("sub", ""),
        email=claims.get("email"),
        role=role,
        company_code=company_code,
    )


def _require(roles: set[str], message: str):
    def dependency(p: Annotated[Principal, Depends(get_principal)]) -> Principal:
        if p.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, message)
        return p

    return dependency


# 顧客ロールなら誰でも（画面上部の会社名など）
require_customer = _require(CUSTOMER_ROLES, "顧客向けの画面です")
# ダッシュボード（利用状況・請求など）
require_dashboard = _require(
    {"company_admin", "viewer"}, "ダッシュボードを閲覧する権限がありません"
)
# CMS の編集・解約の申し込み
require_company_admin = _require({"company_admin"}, "契約管理者のみ操作できます")
# 通話入力と FAQ の検索
require_call_handler = _require({"company_admin", "operator"}, "通話入力の権限がありません")
# 運用コンソール
require_ops = _require({OPS_ROLE}, "運用管理者のみ閲覧できます")
