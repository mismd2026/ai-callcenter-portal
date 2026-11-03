"""Firebase のユーザーにポータルのロールを付ける（カスタムクレームの設定）。

ポータルの API は、このクレームの会社コードとロールだけを信じて表示内容を決める。
ユーザー自身はクレームを変更できない（管理者の権限が必要）。

事前準備:
    pip install firebase-admin
    gcloud auth application-default login

使い方:
    # 顧客（契約管理者）
    python scripts/set_claims.py tanaka@acme.example company_admin ACME-TOKYO
    # 顧客（オペレーター：通話入力と FAQ の検索）
    python scripts/set_claims.py yamada@acme.example operator ACME-TOKYO
    # 顧客（閲覧者）
    python scripts/set_claims.py suzuki@acme.example viewer ACME-TOKYO
    # 運用管理者
    python scripts/set_claims.py ops@example.com ops_admin
"""

from __future__ import annotations

import argparse

import firebase_admin
from firebase_admin import auth

CUSTOMER_ROLES = {"company_admin", "operator", "viewer"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("email")
    parser.add_argument("role", choices=sorted(CUSTOMER_ROLES | {"ops_admin"}))
    parser.add_argument("company_code", nargs="?")
    parser.add_argument("--project", help="Firebase（GCP）のプロジェクト ID")
    args = parser.parse_args()

    if args.role in CUSTOMER_ROLES and not args.company_code:
        parser.error("顧客ロールには会社コードが必要です")

    firebase_admin.initialize_app(options={"projectId": args.project} if args.project else None)
    user = auth.get_user_by_email(args.email)
    claims = {"role": args.role}
    if args.role in CUSTOMER_ROLES:
        claims["company_code"] = args.company_code
    auth.set_custom_user_claims(user.uid, claims)
    # 古いトークンを失効させ、次回から新しいロールで判定されるようにする
    auth.revoke_refresh_tokens(user.uid)
    print(f"{args.email}: {claims}（再ログイン後に反映されます）")


if __name__ == "__main__":
    main()
