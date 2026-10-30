import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { Icon } from './index';

type ToastKind = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; kind: ToastKind; action?: { label: string; onClick: () => void } };
type ToastApi = { show: (message: string, opts?: { kind?: ToastKind; action?: ToastItem['action']; duration?: number }) => void };

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback<ToastApi['show']>(
    (message, opts) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-2), { id, message, kind: opts?.kind ?? 'success', action: opts?.action }]);
      setTimeout(() => dismiss(id), opts?.duration ?? (opts?.kind === 'error' ? 6000 : 4000));
    },
    [dismiss],
  );
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(84px+env(safe-area-inset-bottom))] z-[120] flex flex-col items-center gap-2 px-4 lg:bottom-6 lg:items-end lg:pr-8">
          {items.map((t) => (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-card bg-[#1A1D23] px-4 py-3 text-small text-white shadow-modal"
            >
              <Icon
                name={t.kind === 'success' ? 'check_circle' : t.kind === 'error' ? 'error' : 'info'}
                className={clsx(t.kind === 'success' && 'text-[#66BB6A]', t.kind === 'error' && 'text-[#EF5350]', t.kind === 'info' && 'text-[#90CAF9]')}
              />
              <span className="flex-1">{t.message}</span>
              {t.action ? (
                <button
                  className="font-semibold uppercase tracking-wide text-[#90CAF9]"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : (
                <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="text-white/70 hover:text-white">
                  <Icon name="close" size={18} />
                </button>
              )}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

export function useToast() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useToast must be used within ToastProvider');
  return v;
}
