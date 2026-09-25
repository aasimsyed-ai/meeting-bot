import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import type { Evidence } from '@meeting-assistant/core/ui';
import { formatTimestamp } from '../lib/format';

// ------------------------------------------------------------------ toasts

type Tone = 'info' | 'success' | 'warning' | 'error';
interface ToastItem {
  id: number;
  tone: Tone;
  message: string;
}

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = next.current++;
    setItems((xs) => [...xs.slice(-3), { id, tone, message }]);
    setTimeout(
      () => setItems((xs) => xs.filter((x) => x.id !== id)),
      tone === 'error' ? 9000 : 5000,
    );
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className="toast">
            <ToneIcon tone={t.tone} />
            <span style={{ flex: 1 }}>{t.message}</span>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              style={{ color: 'inherit', height: 20 }}
              aria-label="Dismiss"
              onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === 'success') return <CheckCircle2 size={16} aria-hidden />;
  if (tone === 'warning') return <AlertTriangle size={16} aria-hidden />;
  if (tone === 'error') return <XCircle size={16} aria-hidden />;
  return <Info size={16} aria-hidden />;
}

// ------------------------------------------------------------------ basics

export function Notice({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'success' | 'accent';
  children: ReactNode;
  action?: ReactNode;
}) {
  const icon =
    tone === 'warning' || tone === 'danger' ? (
      <AlertTriangle size={16} aria-hidden />
    ) : tone === 'success' ? (
      <CheckCircle2 size={16} aria-hidden />
    ) : (
      <Info size={16} aria-hidden />
    );
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
    >
      {icon}
      <div className="notice-text">{children}</div>
      {action}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" role="status">
      <span className="spinner" aria-hidden />
      {label ? <span>{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" role="status" aria-busy="true">
      <span className="sr-only">Loading</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Notice
      tone="danger"
      action={
        onRetry ? (
          <button className="btn btn-sm" onClick={onRetry}>
            Try again
          </button>
        ) : undefined
      }
    >
      {message}
    </Notice>
  );
}

export function LevelMeter({
  label,
  level,
  state,
}: {
  label: string;
  level: number;
  state: string;
}) {
  return (
    <div className="meter">
      <div className="row small">
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span className="spacer" />
        <span className="muted">{state}</span>
      </div>
      <div
        className="meter-bar"
        role="meter"
        aria-label={`${label} level`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
      >
        <div className="meter-fill" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ evidence

/** "Why?" shows the exact transcript lines an item came from. */
export function WhyButton({
  evidence,
  onShow,
}: {
  evidence: Evidence;
  onShow?: (e: Evidence) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!evidence.segmentIds.length) return null;
  return (
    <>
      <button
        className="why"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        Why?
      </button>
      {open && (
        <div id={id} className="evidence">
          <div className="small muted" style={{ marginBottom: 4 }}>
            From the transcript at {formatTimestamp(evidence.startMs)}
          </div>
          {evidence.quote ? (
            <div>“{evidence.quote}”</div>
          ) : (
            <div className="muted">The transcript for this meeting was deleted.</div>
          )}
          {onShow && evidence.quote && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 6, marginLeft: -8 }}
              onClick={() => onShow(evidence)}
            >
              Show in transcript
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({
  title,
  onClose,
  children,
  footer,
  labelledBy,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, button, select');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = [
          ...ref.current.querySelectorAll<HTMLElement>('button, input, textarea, select, a[href]'),
        ].filter((x) => !x.hasAttribute('disabled'));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) {
          e.preventDefault();
          f[f.length - 1]!.focus();
        } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
          e.preventDefault();
          f[0]!.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        ref={ref}
      >
        <div className="modal-header">
          <h2 id={titleId} style={{ fontSize: 18 }}>
            {title}
          </h2>
          <span className="spacer" />
          <button className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Render a search snippet whose highlights are marked with \u0001 and \u0002. Never uses HTML. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0001[^\u0002]*\u0002)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('\u0001') ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>,
      )}
    </>
  );
}
