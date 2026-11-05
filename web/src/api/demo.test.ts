import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/demo.json';
import { createDemoApi, createDemoStore, parseCsv, type DemoStore } from './demo';
import { DEMO_IDENTITIES } from './demoIdentities';
import { ApiError, type Role as DemoIdentityRole } from './types';

const id = (role: DemoIdentityRole, company: string | null = 'ACME-TOKYO') =>
  DEMO_IDENTITIES.find((d) => d.role === role && (company === null || d.company_code === company))!;
const fresh = (role: DemoIdentityRole, store: DemoStore = createDemoStore(), company?: string | null) =>
  createDemoApi(id(role, company === undefined ? (role === 'ops_admin' ? null : 'ACME-TOKYO') : company), fixture, store);

describe('デモ API：ダッシュボード（API と同じ集計）', () => {
  it('月別コール数がデモデータの合計と一致する', async () => {
    const monthly = await fresh('company_admin').monthlyCalls();
    const expected = fixture.call_volume
      .filter((v) => v.company_code === 'ACME-TOKYO' && v.month === '2026-07')
      .reduce((s, v) => s + v.count, 0);
    expect(monthly.find((m) => m.period === '2026-07')?.calls).toBe(expected);
  });

  it('問い合わせ種別の割合の合計がほぼ100%になる', async () => {
    const shares = await fresh('company_admin').inquiryBreakdown('2026-07');
    expect(Math.abs(shares.reduce((s, x) => s + x.percent, 0) - 100)).toBeLessThan(0.5);
  });

  it('請求はクレジットを差し引いた額になる', async () => {
    const b = await fresh('company_admin').billing('2026-05');
    expect(b.breakdown[0]).toEqual({ label: '基本ライセンス料', amount: 500000 });
    expect(b.credit_applied).toBe(50000); // クレジットを初月の従量分と相殺
    expect(b.total).toBe(b.subtotal - b.credit_applied);
  });
});

describe('デモ API：権限', () => {
  it('顧客は運用コンソールを開けない', async () => {
    await expect(fresh('company_admin').opsTenants()).rejects.toBeInstanceOf(ApiError);
  });
  it('運用管理者は顧客画面のデータを取得できない', async () => {
    await expect(fresh('ops_admin').company()).rejects.toMatchObject({ status: 403 });
  });
  it('閲覧者は解約・CMS・通話入力ができない', async () => {
    const api = fresh('viewer');
    await expect(api.requestCancellation('x')).rejects.toMatchObject({ status: 403 });
    await expect(api.faqs()).rejects.toMatchObject({ status: 403 });
    await expect(api.searchFaqs('解約')).rejects.toMatchObject({ status: 403 });
  });
  it('オペレーターは通話入力と FAQ 検索はできるが、ダッシュボードと CMS は使えない', async () => {
    const api = fresh('operator');
    expect((await api.searchFaqs('解約の手続き'))[0].category_code).toBe('cancellation');
    await expect(api.billing('2026-07')).rejects.toMatchObject({ status: 403 });
    await expect(api.faqs()).rejects.toMatchObject({ status: 403 });
  });
  it('解約の申し込みは一度だけ', async () => {
    const api = fresh('company_admin');
    await api.requestCancellation('予算の見直し');
    await expect(api.requestCancellation('再送')).rejects.toMatchObject({ status: 409 });
  });
});

describe('デモ API：CMS と通話入力', () => {
  it('下書きの FAQ は検索に出ず、公開すると出る', async () => {
    const store = createDemoStore();
    const admin = fresh('company_admin', store);
    const operator = fresh('operator', store);
    const faq = await admin.createFaq({
      category_code: 'billing',
      questions: ['領収書は発行できますか', '領収書は発行できますか'],
      answer_text: 'マイページから発行できます。',
      status: 'draft',
    });
    expect(faq.questions).toEqual(['領収書は発行できますか']);
    expect((await operator.searchFaqs('領収書を発行したい')).map((f) => f.faq_id)).not.toContain(faq.faq_id);
    await admin.setFaqStatus(faq.faq_id, 'published');
    expect((await operator.searchFaqs('領収書を発行したい'))[0].faq_id).toBe(faq.faq_id);
  });

  it('オペレーターの「FAQ にない」入力が、契約管理者の未回答レビューに届く', async () => {
    const store = createDemoStore();
    await fresh('operator', store).createManualCall({
      category_code: 'usage',
      caller_question: '海外への発送はできますか',
      answer_given: '確認して折り返します',
      faq_id: null,
      outcome: 'callback',
      duration_minutes: 4,
      note: '物流担当に確認',
      not_in_faq: true,
    });
    const admin = fresh('company_admin', store);
    const queue = await admin.unanswered('open');
    const item = queue.find((u) => u.question_text === '海外への発送はできますか')!;
    expect(item).toBeTruthy();
    const faq = await admin.promoteUnanswered(item.id, {
      category_code: 'other',
      questions: [item.question_text],
      answer_text: '現在は国内のみです。',
      status: 'published',
    });
    expect(faq.source).toBe('unanswered');
    expect((await admin.unanswered('promoted'))[0].promoted_faq_id).toBe(faq.faq_id);
  });

  it('入力した通話は利用状況に数え、従量課金の契約だけ通話処理料がかかる', async () => {
    const store = createDemoStore();
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const input = {
      category_code: 'usage',
      caller_question: '駐車場はありますか',
      answer_given: 'あります',
      faq_id: null,
      outcome: 'resolved' as const,
      duration_minutes: 2,
      note: null,
      not_in_faq: false,
    };
    // 東京本社：月額定額（既定）
    const operator = fresh('operator', store);
    await operator.createManualCall(input);
    await operator.createManualCall(input);
    const admin = fresh('company_admin', store);
    expect((await admin.company()).billing_model).toBe('subscription');
    expect((await admin.monthlyCalls()).find((m) => m.period === period)?.calls).toBe(2);
    expect((await admin.billing(period)).breakdown.find((b) => b.label === '通話処理料')).toBeUndefined();

    // 大阪支店：従量課金
    const osaka = { label: '', description: '', company_code: 'ACME-OSAKA' };
    const osakaOperator = createDemoApi({ ...osaka, role: 'operator' }, fixture, store);
    await osakaOperator.createManualCall(input);
    await osakaOperator.createManualCall(input);
    const osakaAdmin = createDemoApi({ ...osaka, role: 'company_admin' }, fixture, store);
    const company = await osakaAdmin.company();
    expect(company.billing_model).toBe('metered');
    const bill = await osakaAdmin.billing(period);
    expect(bill.breakdown.find((b) => b.label === '通話処理料')?.amount).toBe(company.per_call_fee! * 2);
    expect(bill.total).toBe(bill.subtotal - bill.credit_applied);
    // 初回のクレジットは使い切っているので、運用管理者が追加すると相殺される
    await fresh('ops_admin', store).opsGrantCredit('ACME-OSAKA', { amount: 30000, reason: '追加', expires_at: null });
    expect((await osakaAdmin.billing(period)).credit_applied).toBe(company.per_call_fee! * 2);
  });

  it('CSV は検証してから下書きとして取り込む', async () => {
    const admin = fresh('company_admin');
    const csv = 'category,question,answer\n料金・請求,"宛名を変えたい|宛名, 変更",契約者情報から変更できます\n不明,質問,回答\n';
    const dry = await admin.importFaqs(csv, false);
    expect(dry.errors).toEqual([{ row: 3, message: '問い合わせ種別「不明」は使えません' }]);
    expect(dry.imported).toBe(0);
    const ok = await admin.importFaqs(csv.split('\n').slice(0, 2).join('\n'), false);
    expect(ok.imported).toBe(1);
    const drafts = await admin.faqs('draft');
    expect(drafts.some((f) => f.source === 'csv' && f.questions.includes('宛名, 変更'))).toBe(true);
  });

  it('運用管理者がクレジットを付与すると残高が増える', async () => {
    const store = createDemoStore();
    const ops = fresh('ops_admin', store);
    const before = (await ops.opsCompanies('MIDORI'))[0].credit_balance;
    const r = await ops.opsGrantCredit('MIDORI-MAIN', { amount: 30000, reason: '追加', expires_at: null });
    expect(r.credit_balance).toBe(before + 30000);
  });
});

describe('CSV の読み取り', () => {
  it('引用符・カンマ・改行・BOM に対応する', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
});
