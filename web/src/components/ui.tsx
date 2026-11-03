// CMS・通話入力の画面で共通に使う小さな部品
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-[#E4E7EC] p-5 sm:p-6">
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          {title && <h2 className="font-display font-semibold text-[15px]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-[#0F9B8E] text-white hover:bg-[#0C8478]',
  secondary: 'border border-[#D0D5DD] bg-white text-[#344054] hover:bg-[#F7F8FA]',
  danger: 'border border-[#FDA29B] bg-white text-[#B42318] hover:bg-[#FEF3F2]',
  ghost: 'text-[#475467] hover:bg-[#F0F1F3]',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-[#344054] font-medium">{label}</span>
      {hint && <span className="block text-xs text-[#98A2B3] mt-0.5">{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputClass =
  'w-full rounded-lg border border-[#D0D5DD] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0F9B8E]/40';

export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'gray' | 'blue' | 'red'; children: ReactNode }) {
  const tones = {
    green: 'bg-[#0F9B8E]/10 text-[#0B7A70]',
    amber: 'bg-[#F5A623]/15 text-[#B54708]',
    gray: 'bg-[#F2F4F7] text-[#475467]',
    blue: 'bg-[#3B7DD8]/10 text-[#2E66B5]',
    red: 'bg-[#FEE4E2] text-[#B42318]',
  };
  return <span className={`inline-block text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info'; children: ReactNode }) {
  const styles = {
    ok: 'border-[#0F9B8E]/30 bg-[#0F9B8E]/5 text-[#0B7A70]',
    error: 'border-[#FDA29B] bg-[#FEF3F2] text-[#B42318]',
    info: 'border-[#D0D5DD] bg-[#F9FAFB] text-[#475467]',
  };
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${styles[kind]}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '処理できませんでした';
}
