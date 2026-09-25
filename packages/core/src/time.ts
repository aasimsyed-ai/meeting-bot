/** Time helpers. Calendar math is done on plain Y-M-D values to avoid time-zone drift. */

export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'under a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export interface CalendarDate {
  y: number;
  m: number; // 1-12
  d: number;
}

/** The calendar date on which an instant falls in the given IANA time zone. */
export function localDate(iso: string, timeZone?: string): CalendarDate {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${iso}`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZone || undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

export function toIsoDate(c: CalendarDate): string {
  return `${c.y}-${String(c.m).padStart(2, '0')}-${String(c.d).padStart(2, '0')}`;
}

export function fromIsoDate(s: string): CalendarDate {
  const [y, m, d] = s.split('-').map(Number);
  return { y: y!, m: m!, d: d! };
}

function toUtc(c: CalendarDate): Date {
  return new Date(Date.UTC(c.y, c.m - 1, c.d, 12));
}

function fromUtc(d: Date): CalendarDate {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

export function addDays(c: CalendarDate, n: number): CalendarDate {
  const d = toUtc(c);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** 0 = Sunday ... 6 = Saturday */
export function weekday(c: CalendarDate): number {
  return toUtc(c).getUTCDay();
}

export function endOfMonth(c: CalendarDate): CalendarDate {
  return fromUtc(new Date(Date.UTC(c.y, c.m, 0, 12)));
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const WEEKDAYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function formatFriendlyDate(iso: string): string {
  const c = fromIsoDate(iso);
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(toUtc(c));
}

export function formatLongDate(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: timeZone || undefined,
  }).format(new Date(iso));
}
