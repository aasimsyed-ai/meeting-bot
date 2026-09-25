import { Download } from 'lucide-react';
import { call } from '../api';
import { useApp } from '../App';
import { Notice } from '../components/ui';

export function mb(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

/** Speech engine status, shown until it is ready. */
export function ModelNotice({ compact }: { compact?: boolean }) {
  const { model } = useApp();
  if (model.ready) return null;
  if (model.downloading) {
    return (
      <div className="card">
        <div className="card-body stack" style={{ gap: 8 }}>
          <div className="row">
            <span style={{ fontWeight: 600 }}>Downloading the speech engine…</span>
            <span className="spacer" />
            <span className="muted small">
              {Math.round(model.progress * 100)}% of {mb(model.totalBytes)}
            </span>
          </div>
          <div
            className="progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(model.progress * 100)}
            aria-label="Speech engine download"
          >
            <div style={{ width: `${model.progress * 100}%` }} />
          </div>
          {!compact && (
            <span className="small muted">
              You can keep using the app. Meetings you record now are transcribed as soon as this
              finishes.
            </span>
          )}
          <div>
            <button className="btn btn-sm btn-ghost" onClick={() => void call('models:cancel')}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <Notice
      tone={model.error ? 'warning' : 'accent'}
      action={
        <button className="btn btn-sm" onClick={() => void call('models:download')}>
          <Download size={14} aria-hidden /> {model.error ? 'Try again' : 'Download'}
        </button>
      }
    >
      {model.error ??
        `To turn speech into text on this computer, Meeting Assistant needs a one-time download of its speech engine (${mb(model.totalBytes)}).`}
    </Notice>
  );
}
