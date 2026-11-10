// App-level UI kit built on shadcn/ui primitives (button.tsx, input.tsx, card.tsx, badge.tsx, alert.tsx, label.tsx).
// Feature code imports from here so the variant names stay stable.
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { Button as UiButton } from './button';
import { Input as UiInput } from './input';
import { Card as UiCard } from './card';
import { Badge } from './badge';
import { Alert as UiAlert, AlertDescription } from './alert';
import { Label } from './label';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark';
const VARIANT = { primary: 'default', secondary: 'outline', ghost: 'ghost', danger: 'destructive', dark: 'dark' } as const;
const SIZE = { sm: 'sm', md: 'default', lg: 'lg' } as const;

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg'; loading?: boolean }>(
  function Button({ variant = 'primary', size = 'md', loading, children, disabled, ...rest }, ref) {
    return (
      <UiButton ref={ref} variant={VARIANT[variant]} size={SIZE[size]} disabled={disabled || loading} {...rest}>
        {loading && <Spinner className="h-4 w-4" />}
        {children}
      </UiButton>
    );
  },
);

export function Spinner({ className = 'h-6 w-6' }: { className?: string }) {
  return <span className={cn('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className)} role="status" aria-label="Loading" />;
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <Label className="block space-y-1.5 font-normal">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      {children}
      {error ? <span className="block text-sm text-destructive">{error}</span> : hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </Label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <UiInput ref={ref} className={cn('bg-card', className)} {...p} />;
});

/** Native select keeps mobile pickers and form semantics; styled to match shadcn Input. */
export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50', className)} {...p}>
      {children}
    </select>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <UiCard className={cn('gap-0 rounded-[var(--radius-card)] p-5 shadow-none', className)}>{children}</UiCard>;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'info' | 'success'; children: ReactNode }) {
  return (
    <UiAlert variant={kind === 'error' ? 'destructive' : 'default'} role={kind === 'error' ? 'alert' : 'status'}
      className={cn(kind === 'error' && 'border-destructive/30 bg-red-50', kind === 'success' && 'border-green-700/30 text-green-800')}>
      <AlertDescription className={cn(kind === 'error' ? 'text-destructive' : kind === 'success' ? 'text-green-800' : 'text-foreground')}>{children}</AlertDescription>
    </UiAlert>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed px-4 py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <svg width="24" height="24" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#1c1917" />
        <path d="M6 17 L13 12 L20 17 Z" fill="#a8a29e" />
        <rect x="7.5" y="17" width="11" height="8" fill="#f6f3ee" />
        <rect x="20" y="9" width="6" height="16" fill="#f6f3ee" />
      </svg>
      CIVITAS
    </span>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return <Badge variant={role === 'owner' ? 'default' : 'secondary'} className="capitalize">{role}</Badge>;
}
