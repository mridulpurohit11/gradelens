import { forwardRef, useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { initials } from '@/lib/format';

// ---------- Icon ----------

export function Icon({ name, className, fill, size = 20 }: { name: string; className?: string; fill?: boolean; size?: number }) {
  return (
    <span aria-hidden className={clsx('icon shrink-0', fill && 'icon-fill', className)} style={{ fontSize: size, width: size, height: size }}>
      {name}
    </span>
  );
}

// ---------- Buttons ----------

type BtnVariant = 'primary' | 'secondary' | 'danger' | 'danger-solid' | 'ghost' | 'text' | 'tint';
type BtnSize = 'sm' | 'md' | 'lg';

const btnBase =
  'inline-flex items-center justify-center gap-2 rounded-ctl font-semibold transition-colors select-none disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';
const btnVariants: Record<BtnVariant, string> = {
  primary: 'bg-primary text-primary-on hover:bg-primary-hover active:bg-primary-hover',
  secondary: 'bg-surface text-primary border border-line hover:bg-primary-tint hover:border-primary',
  danger: 'bg-surface text-danger border border-danger/60 hover:bg-danger-tint',
  'danger-solid': 'bg-danger text-white hover:bg-danger/90',
  ghost: 'text-ink hover:bg-subtle',
  text: 'text-primary hover:underline underline-offset-2 px-0',
  tint: 'bg-primary-tint text-primary hover:bg-primary-tint/70',
};
const btnSizes: Record<BtnSize, string> = {
  sm: 'h-9 px-3 text-small',
  md: 'h-11 lg:h-10 px-4 text-body',
  lg: 'h-12 px-5 text-body',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: string;
  iconRight?: string;
  loading?: boolean;
  full?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, full, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(btnBase, btnVariants[variant], variant !== 'text' && btnSizes[size], variant === 'text' && 'text-body h-auto', full && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon ? <Icon name={icon} size={size === 'sm' ? 18 : 20} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={size === 'sm' ? 18 : 20} /> : null}
    </button>
  );
});

export function IconButton({
  icon,
  label,
  badge,
  className,
  fill,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string; label: string; badge?: number; fill?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx('relative inline-flex h-10 w-10 items-center justify-center rounded-ctl text-muted hover:bg-subtle hover:text-primary transition-colors', className)}
      {...rest}
    >
      <Icon name={icon} size={22} fill={fill} />
      {badge ? (
        <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-surface bg-danger px-0.5 text-[10px] font-semibold leading-none text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className ?? 'h-5 w-5')} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------- Form controls ----------

export function Field({
  label,
  required,
  optional,
  hint,
  error,
  right,
  children,
  className,
  htmlFor,
}: {
  label?: ReactNode;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={className}>
      {label ? (
        <div className="mb-1.5 flex items-end justify-between gap-2">
          <label htmlFor={htmlFor} className="text-small font-semibold text-ink">
            {label}
            {required ? <span className="text-danger"> *</span> : null}
            {optional ? <span className="font-normal text-muted"> (optional)</span> : null}
          </label>
          {right}
        </div>
      ) : null}
      {children}
      {error ? (
        <p className="mt-1.5 flex items-center gap-1 text-caption text-danger" role="alert">
          <Icon name="error" size={14} />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-caption text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; icon?: string; trailing?: ReactNode }>(
  function Input({ className, invalid, icon, trailing, ...rest }, ref) {
    if (!icon && !trailing) return <input ref={ref} className={clsx('input', invalid && 'input-error', className)} {...rest} />;
    return (
      <div className="relative">
        {icon ? <Icon name={icon} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" /> : null}
        <input ref={ref} className={clsx('input', icon && 'pl-10', trailing && 'pr-11', invalid && 'input-error', className)} {...rest} />
        {trailing ? <div className="absolute right-2 top-1/2 -translate-y-1/2">{trailing}</div> : null}
      </div>
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function TextArea(
  { className, invalid, rows = 4, ...rest },
  ref,
) {
  return <textarea ref={ref} rows={rows} className={clsx('input h-auto py-3 leading-5', invalid && 'input-error', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; placeholder?: string }>(
  function Select({ className, invalid, children, placeholder, ...rest }, ref) {
    return (
      <div className="relative">
        <select ref={ref} className={clsx('input appearance-none pr-10', invalid && 'input-error', className)} {...rest}>
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {children}
        </select>
        <Icon name="expand_more" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>
    );
  },
);

export function Toggle({
  checked,
  onChange,
  label,
  description,
  icon,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  icon?: string;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const sw = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-line',
      )}
    >
      <span className={clsx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
  if (!label) return sw;
  return (
    <div className={clsx('flex items-start justify-between gap-4', className)}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="flex items-center gap-2 text-body font-semibold text-ink">
          {icon ? <Icon name={icon} size={18} className="text-muted" /> : null}
          {label}
        </span>
        {description ? <span className="mt-0.5 block text-small text-muted">{description}</span> : null}
      </label>
      {sw}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  size = 'md',
}: {
  options: { value: T; label: string; icon?: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" className={clsx('flex rounded-ctl border border-line bg-subtle p-0.5', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            'flex flex-1 items-center justify-center gap-1.5 rounded-[6px] px-2 font-medium transition-colors',
            size === 'sm' ? 'h-8 text-caption' : 'h-10 text-small',
            value === o.value ? 'bg-primary text-primary-on shadow-card font-semibold' : 'text-muted hover:text-ink',
          )}
        >
          {o.icon ? <Icon name={o.icon} size={18} /> : null}
          <span className="truncate">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------- Chips ----------

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'primary' | 'outline';

const toneCls: Record<Tone, string> = {
  success: 'bg-success-tint text-success border-success/40',
  warning: 'bg-warning-tint text-warning border-warning/40',
  danger: 'bg-danger-tint text-danger border-danger/40',
  info: 'bg-info-tint text-info border-info/40',
  neutral: 'bg-subtle text-muted border-line',
  primary: 'bg-primary-tint text-primary border-primary/20',
  outline: 'bg-transparent text-muted border-line',
};

export function Chip({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: string; children: ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex h-6 max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-caption font-semibold', toneCls[tone], className)}>
      {icon ? <Icon name={icon} size={14} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function FilterChip({ active, children, onClick, count }: { active: boolean; children: ReactNode; onClick: () => void; count?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-3.5 text-small font-medium transition-colors',
        active ? 'border-primary bg-primary text-primary-on' : 'border-line bg-surface text-ink hover:border-primary/50',
      )}
    >
      {children}
      {count !== undefined ? <span className={clsx('tnum', active ? 'opacity-90' : 'text-muted')}>({count})</span> : null}
    </button>
  );
}

// ---------- Surfaces ----------

export function Card({ className, children, padded = true, as: As = 'div', ...rest }: { className?: string; children: ReactNode; padded?: boolean; as?: 'div' | 'section' | 'article' } & Record<string, unknown>) {
  return (
    <As className={clsx('card', padded && 'p-4 lg:p-5', className)} {...rest}>
      {children}
    </As>
  );
}

export function SectionTitle({ children, action, className, sub }: { children: ReactNode; action?: ReactNode; className?: string; sub?: ReactNode }) {
  return (
    <div className={clsx('mb-3 flex items-end justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-h3 text-ink">{children}</h2>
        {sub ? <p className="text-small text-muted">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone,
  icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'warning' | 'danger' | 'success';
  icon?: string;
  onClick?: () => void;
}) {
  const color = tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : 'text-ink';
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={clsx('card flex min-w-0 flex-col p-4 text-left lg:p-5', onClick && 'transition-colors hover:border-primary/40')}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-small text-muted">{label}</span>
        {icon ? <Icon name={icon} size={20} className={clsx(tone ? color : 'text-muted')} /> : null}
      </div>
      <span className={clsx('tnum mt-2 text-stat', color)}>{value}</span>
      {sub ? <span className={clsx('mt-1 text-small', tone ? color : 'text-muted')}>{sub}</span> : null}
    </Comp>
  );
}

export function ProgressBar({ value, tone = 'primary', className }: { value: number; tone?: 'primary' | 'success' | 'warning' | 'danger'; className?: string }) {
  const color = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' }[tone];
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-primary-tint', className)} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className={clsx('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </div>
  );
}

export function ProgressRing({ value, size = 140, stroke = 12, children }: { value: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(var(--primary-tint))" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgb(var(--primary))"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}

export function Avatar({ name, src, size = 40, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  return (
    <span
      className={clsx('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-semibold text-primary-on', className)}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : initials(name)}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-ctl bg-line/60', className)} />;
}

export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={clsx('space-y-3', className)} aria-busy>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card space-y-3 p-4">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon: string; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('card flex flex-col items-center px-6 py-10 text-center', className)}>
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-tint text-primary">
        <Icon name={icon} size={28} />
      </span>
      <h3 className="text-h3 text-ink">{title}</h3>
      {body ? <p className="mt-1 max-w-sm text-body text-muted">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong.';
  const offline = /internet/i.test(msg);
  return (
    <div className={clsx('card flex flex-col items-center px-6 py-10 text-center', className)}>
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-danger-tint text-danger">
        <Icon name={offline ? 'wifi_off' : 'error'} size={28} />
      </span>
      <h3 className="text-h3 text-ink">{offline ? 'No internet connection' : 'Unable to load'}</h3>
      <p className="mt-1 max-w-sm text-body text-muted">{msg}</p>
      {onRetry ? (
        <Button variant="secondary" icon="refresh" className="mt-5" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Banner({ tone = 'info', icon, title, children, action, className }: { tone?: 'info' | 'warning' | 'danger' | 'success'; icon?: string; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const cls = {
    info: 'border-info/40 bg-info-tint text-info',
    warning: 'border-warning/40 bg-warning-tint text-warning',
    danger: 'border-danger/40 bg-danger-tint text-danger',
    success: 'border-success/40 bg-success-tint text-success',
  }[tone];
  const defIcon = { info: 'info', warning: 'warning', danger: 'error', success: 'check_circle' }[tone];
  return (
    <div className={clsx('flex gap-3 rounded-card border p-3.5', cls, className)} role={tone === 'danger' ? 'alert' : undefined}>
      <Icon name={icon ?? defIcon} size={20} className="mt-0.5" />
      <div className="min-w-0 flex-1 text-small">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={clsx(title && 'mt-0.5', 'text-ink/80 dark:text-ink/80')}>{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}

// ---------- Tabs & stepper ----------

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div role="tablist" className={clsx('flex border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          type="button"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            '-mb-px flex-1 border-b-2 px-3 py-3 text-body font-medium transition-colors lg:flex-none lg:px-5',
            value === t.value ? 'border-primary text-primary font-semibold' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined ? <span className="ml-1 text-muted">({t.count})</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ steps, current, onStep }: { steps: string[]; current: number; onStep?: (i: number) => void }) {
  return (
    <ol className="flex items-center">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s} className={clsx('flex items-center', i < steps.length - 1 && 'flex-1')}>
            <button
              type="button"
              disabled={!onStep || i > current}
              onClick={() => onStep?.(i)}
              className="flex shrink-0 flex-col items-center gap-1 sm:flex-row sm:gap-2"
            >
              <span
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-full border text-small font-semibold',
                  done && 'border-primary bg-primary text-primary-on',
                  active && 'border-primary bg-primary text-primary-on ring-4 ring-primary-tint',
                  !done && !active && 'border-line bg-surface text-muted',
                )}
              >
                {done ? <Icon name="check" size={18} /> : i + 1}
              </span>
              <span className={clsx('text-caption sm:text-small', active ? 'font-semibold text-ink' : 'text-muted')}>{s}</span>
            </button>
            {i < steps.length - 1 ? <span className={clsx('mx-2 h-0.5 flex-1 rounded-full sm:mx-3', done ? 'bg-primary' : 'bg-line')} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

// ---------- Dialog ----------

export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  tone,
  icon,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  tone?: 'danger';
  icon?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-[#1A1D23]/40" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        className={clsx(
          'safe-bottom relative w-full rounded-t-[16px] border border-line bg-surface shadow-modal outline-none sm:rounded-card',
          wide ? 'sm:max-w-2xl' : 'sm:max-w-md',
          tone === 'danger' && 'border-l-4 border-l-danger',
        )}
      >
        <div className="max-h-[85dvh] overflow-y-auto p-5">
          <div className="flex items-start gap-3">
            {icon ? (
              <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', tone === 'danger' ? 'bg-danger-tint text-danger' : 'bg-primary-tint text-primary')}>
                <Icon name={icon} />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 className="text-h3 text-ink">{title}</h2>
              {children ? <div className="mt-2 text-body text-muted">{children}</div> : null}
            </div>
          </div>
          {actions ? <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{actions}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  tone,
  loading,
  icon,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  tone?: 'danger';
  loading?: boolean;
  icon?: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      tone={tone}
      icon={icon ?? (tone === 'danger' ? 'warning' : 'help')}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body}
    </Dialog>
  );
}

// ---------- Misc ----------

export function Divider({ className }: { className?: string }) {
  return <hr className={clsx('border-line', className)} />;
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-small text-muted">{label}</span>
      <span className="text-small font-semibold text-ink">{children}</span>
    </div>
  );
}
