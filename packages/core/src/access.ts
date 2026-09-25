/**
 * Access policy for meeting data. The desktop app is single-user today, but
 * every read and write goes through these checks so data boundaries stay
 * correct when notes are shared or synced later.
 */

export interface Principal {
  userId: string;
  tenantId: string;
  email: string;
  isAdmin?: boolean;
  disabled?: boolean;
}

export interface MeetingAcl {
  tenantId: string;
  ownerId: string;
  organizerEmail?: string | null;
  /** Attendee emails. External attendees are those outside the tenant's domains. */
  attendees: { email: string; external: boolean }[];
  /** Whether the owner has shared the notes with attendees. */
  sharedWithAttendees: boolean;
}

export type MeetingRole = 'owner' | 'admin' | 'organizer' | 'attendee' | 'external' | 'none';

export function roleFor(p: Principal, m: MeetingAcl): MeetingRole {
  if (p.disabled || p.tenantId !== m.tenantId) {
    // Different tenant: only an explicitly listed external attendee may see shared notes.
    const ext = m.attendees.find(
      (a) => a.email.toLowerCase() === p.email.toLowerCase() && a.external,
    );
    return !p.disabled && ext ? 'external' : 'none';
  }
  if (p.userId === m.ownerId) return 'owner';
  if (p.isAdmin) return 'admin';
  if (m.organizerEmail && m.organizerEmail.toLowerCase() === p.email.toLowerCase())
    return 'organizer';
  const a = m.attendees.find((x) => x.email.toLowerCase() === p.email.toLowerCase());
  if (a) return a.external ? 'external' : 'attendee';
  return 'none';
}

export type Permission =
  | 'view_notes'
  | 'view_transcript'
  | 'edit_notes'
  | 'edit_tasks'
  | 'draft_email'
  | 'send_email'
  | 'delete_meeting';

const MATRIX: Record<MeetingRole, (m: MeetingAcl) => Permission[]> = {
  owner: () => [
    'view_notes',
    'view_transcript',
    'edit_notes',
    'edit_tasks',
    'draft_email',
    'send_email',
    'delete_meeting',
  ],
  admin: () => ['view_notes', 'view_transcript', 'delete_meeting'],
  organizer: (m) =>
    m.sharedWithAttendees
      ? ['view_notes', 'view_transcript', 'edit_notes', 'edit_tasks', 'draft_email', 'send_email']
      : [],
  attendee: (m) => (m.sharedWithAttendees ? ['view_notes', 'view_transcript', 'edit_tasks'] : []),
  // External people only ever see the shared summary, never the raw transcript.
  external: (m) => (m.sharedWithAttendees ? ['view_notes'] : []),
  none: () => [],
};

export function can(
  p: Principal | null | undefined,
  m: MeetingAcl,
  permission: Permission,
): boolean {
  if (!p || p.disabled) return false;
  return MATRIX[roleFor(p, m)](m).includes(permission);
}

export class AccessDeniedError extends Error {
  constructor(message = 'You do not have access to this meeting.') {
    super(message);
    this.name = 'AccessDeniedError';
  }
}

export function assertCan(
  p: Principal | null | undefined,
  m: MeetingAcl,
  permission: Permission,
): void {
  if (!can(p, m, permission)) throw new AccessDeniedError();
}
