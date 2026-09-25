import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Small file logger. Logs events and ids, never transcript text, email
 * bodies or secrets. Values that look like keys or emails are redacted.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const MAX_BYTES = 5 * 1024 * 1024;
const REDACTIONS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[redacted]'],
  [/\b(?:api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*\S+/gi, '$1=[redacted]'],
  [/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
];

export function redact(input: string): string {
  let s = input;
  for (const [re, rep] of REDACTIONS) s = s.replace(re, rep);
  return s.length > 2000 ? s.slice(0, 2000) + '…' : s;
}

export class Logger {
  private file: string | null = null;

  constructor(private readonly echo = true) {}

  setDirectory(dir: string): void {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'main.log');
  }

  get path(): string | null {
    return this.file;
  }

  private write(level: Level, event: string, fields?: Record<string, unknown>): void {
    const line = redact(
      JSON.stringify({ t: new Date().toISOString(), level, event, ...sanitize(fields ?? {}) }),
    );
    if (this.echo && (level !== 'debug' || process.env.MEETING_ASSISTANT_DEBUG)) {
      (level === 'error' ? console.error : console.log)(line);
    }
    if (!this.file) return;
    try {
      if (existsSync(this.file) && statSync(this.file).size > MAX_BYTES) {
        renameSync(this.file, this.file + '.1');
      }
      appendFileSync(this.file, line + '\n', { mode: 0o600 });
    } catch {
      // Logging must never break the app.
    }
  }

  debug(event: string, fields?: Record<string, unknown>) {
    this.write('debug', event, fields);
  }
  info(event: string, fields?: Record<string, unknown>) {
    this.write('info', event, fields);
  }
  warn(event: string, fields?: Record<string, unknown>) {
    this.write('warn', event, fields);
  }
  error(event: string, fields?: Record<string, unknown>) {
    this.write('error', event, fields);
  }
}

/** Only log primitive fields and error messages; drop anything that could hold content. */
function sanitize(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (/text|body|transcript|content|quote|prompt/i.test(k)) continue;
    if (v instanceof Error) out[k] = `${v.name}: ${v.message}`;
    else if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[k] = v;
  }
  return out;
}

export const log = new Logger();
