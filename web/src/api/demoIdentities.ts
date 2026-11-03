// デモで選べるユーザー（デモデータ本体とは分けて、本番の画面に含めないようにしている）
import type { Role } from './types';

export interface DemoIdentity {
  label: string;
  description: string;
  role: Role;
  company_code: string | null;
}

export const DEMO_IDENTITIES: DemoIdentity[] = [
  {
    label: '田中 一郎（契約管理者）',
    description: '株式会社ACME 東京本社。ダッシュボード、FAQ などの CMS、通話入力、解約の申し込み',
    role: 'company_admin',
    company_code: 'ACME-TOKYO',
  },
  {
    label: '森 さくら（契約管理者）',
    description: 'みどりクリニック 本院。小規模プランの例',
    role: 'company_admin',
    company_code: 'MIDORI-MAIN',
  },
  {
    label: '山田 美咲（オペレーター）',
    description: '株式会社ACME 東京本社。電話を受けて内容を入力し、FAQ を検索できます',
    role: 'operator',
    company_code: 'ACME-TOKYO',
  },
  {
    label: '鈴木 花子（閲覧者）',
    description: '株式会社ACME 東京本社。閲覧のみ',
    role: 'viewer',
    company_code: 'ACME-TOKYO',
  },
  {
    label: '運用管理者',
    description: '全テナントの契約状況と利用者の確認、クレジットの付与',
    role: 'ops_admin',
    company_code: null,
  },
];
