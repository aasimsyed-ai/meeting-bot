import { randomUUID } from 'node:crypto';
import {
  assertCan,
  buildFtsQuery,
  diffMeetings,
  hash53,
  localDate,
  seriesKey,
  toIsoDate,
  type ActionItem,
  type AnalyzeResult,
  type Decision,
  type Deadline,
  type Evidence,
  type MeetingAcl,
  type MeetingNotes,
  type MemoryMeeting,
  type OpenQuestion,
  type Participant,
  type Permission,
  type Platform,
  type Principal,
  type Risk,
  type ScreenNote,
  type Topic,
  type TranscriptSegment,
} from '@meeting-assistant/core';
import type {
  EmailDraftRow,
  EmailStatus,
  MeetingDetail,
  MeetingStatus,
  MeetingSummary,
  SearchHit,
  SpeakerRow,
  TaskFilter,
  TaskPatch,
  TaskRow,
} from '../../shared/types';
import { tx, type Db } from './database';

type Row = Record<string, unknown>;

export const LOCAL_TENANT = 'local';
export const LOCAL_USER = 'local-user';

export class NotFoundError extends Error {
  constructor(what = 'That meeting no longer exists.') {
    super(what);
    this.name = 'NotFoundError';
  }
}

const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
const num = (v: unknown) => Number(v ?? 0);
const json = <T>(v: unknown, fallback: T): T => {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

export interface NewMeeting {
  title: string;
  platform: Platform;
  startedAt: string;
  timeZone: string | null;
  source: 'live' | 'demo' | 'sample';
  participants?: Participant[];
  status?: MeetingStatus;
  id?: string;
}

/**
 * All data access for the desktop app. Every method takes the acting
 * principal and checks the shared access policy, so data boundaries are
 * enforced in one place (and tested against a second tenant).
 */
export class Repo {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private ts(): string {
    return this.now().toISOString();
  }

  // ------------------------------------------------------------------ identity

  ensureLocalUser(name: string, email: string | null): Principal {
    const at = this.ts();
    this.db
      .prepare('INSERT OR IGNORE INTO tenants (id, name, created_at) VALUES (?, ?, ?)')
      .run(LOCAL_TENANT, 'This computer', at);
    this.db
      .prepare(
        'INSERT OR IGNORE INTO users (id, tenant_id, name, email, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(LOCAL_USER, LOCAL_TENANT, name || 'Me', email, at);
    return this.principal(LOCAL_USER);
  }

  updateUser(userId: string, name: string, email: string | null): void {
    this.db.prepare('UPDATE users SET name = ?, email = ? WHERE id = ?').run(name, email, userId);
  }

  principal(userId: string): Principal {
    const u = this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as Row | undefined;
    if (!u) throw new NotFoundError('User not found.');
    return {
      userId: String(u.id),
      tenantId: String(u.tenant_id),
      email: str(u.email) ?? '',
      isAdmin: Boolean(u.is_admin),
      disabled: Boolean(u.disabled),
    };
  }

  /** Test and future multi-user support: create a tenant/user pair. */
  createUser(
    tenantId: string,
    userId: string,
    name: string,
    email: string,
    opts: { isAdmin?: boolean; disabled?: boolean } = {},
  ): Principal {
    const at = this.ts();
    this.db
      .prepare('INSERT OR IGNORE INTO tenants (id, name, created_at) VALUES (?, ?, ?)')
      .run(tenantId, tenantId, at);
    this.db
      .prepare(
        'INSERT INTO users (id, tenant_id, name, email, is_admin, disabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(userId, tenantId, name, email, opts.isAdmin ? 1 : 0, opts.disabled ? 1 : 0, at);
    return this.principal(userId);
  }

  private userName(userId: string): string {
    const u = this.db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as Row | undefined;
    return str(u?.name) ?? 'Me';
  }

  // ------------------------------------------------------------------ access

  private acl(meetingId: string): MeetingAcl & { row: Row } {
    const row = this.db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId) as
      Row | undefined;
    if (!row) throw new NotFoundError();
    const attendees = (
      this.db
        .prepare('SELECT email FROM participants WHERE meeting_id = ? AND email IS NOT NULL')
        .all(meetingId) as Row[]
    ).map((r) => ({ email: String(r.email), external: false }));
    return {
      row,
      tenantId: String(row.tenant_id),
      ownerId: String(row.owner_id),
      organizerEmail: str(row.organizer_email),
      attendees,
      sharedWithAttendees: Boolean(row.shared_with_attendees),
    };
  }

  private check(p: Principal, meetingId: string, permission: Permission): Row {
    const a = this.acl(meetingId);
    assertCan(p, a, permission);
    return a.row;
  }

  /** Meetings the principal may view (owner or admin in the same tenant). */
  private visibleWhere(p: Principal): { sql: string; args: string[] } {
    if (p.disabled) return { sql: '1 = 0', args: [] };
    if (p.isAdmin) return { sql: 'm.tenant_id = ?', args: [p.tenantId] };
    return { sql: 'm.tenant_id = ? AND m.owner_id = ?', args: [p.tenantId, p.userId] };
  }

  // ------------------------------------------------------------------ meetings

  createMeeting(p: Principal, m: NewMeeting): string {
    if (p.disabled) throw new Error('This account is disabled.');
    const id = m.id ?? `mtg_${randomUUID().replace(/-/g, '')}`;
    const at = this.ts();
    tx(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO meetings (id, tenant_id, owner_id, title, platform, status, source, started_at, time_zone, series_key, is_sample, organizer_email, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          p.tenantId,
          p.userId,
          m.title,
          m.platform,
          m.status ?? 'capturing',
          m.source,
          m.startedAt,
          m.timeZone,
          seriesKey(m.title),
          m.source === 'sample' || m.source === 'demo' ? 1 : 0,
          m.participants?.find((x) => x.role === 'organizer')?.email ?? null,
          at,
          at,
        );
      this.writeParticipants(id, m.participants ?? []);
      this.indexTitle(id, m.title);
    });
    this.audit(p, 'capture_started', id, m.source);
    return id;
  }

  private writeParticipants(meetingId: string, participants: Participant[]): void {
    this.db.prepare('DELETE FROM participants WHERE meeting_id = ?').run(meetingId);
    const ins = this.db.prepare(
      'INSERT INTO participants (meeting_id, position, name, email, role) VALUES (?, ?, ?, ?, ?)',
    );
    participants.forEach((x, i) =>
      ins.run(meetingId, i, x.name, x.email ?? null, x.role ?? 'required'),
    );
  }

  private indexTitle(meetingId: string, title: string): void {
    this.db
      .prepare("DELETE FROM search_index WHERE meeting_id = ? AND kind = 'title'")
      .run(meetingId);
    this.db
      .prepare(
        "INSERT INTO search_index (meeting_id, kind, ref, start_ms, text) VALUES (?, 'title', '', NULL, ?)",
      )
      .run(meetingId, title);
  }

  setStatus(
    p: Principal,
    meetingId: string,
    status: MeetingStatus,
    extra: {
      endedAt?: string;
      durationMs?: number;
      stage?: string | null;
      error?: string | null;
    } = {},
  ): void {
    this.check(p, meetingId, 'edit_notes');
    const sets = ['status = ?', 'updated_at = ?'];
    const args: (string | number | null)[] = [status, this.ts()];
    if (extra.endedAt !== undefined) {
      sets.push('ended_at = ?');
      args.push(extra.endedAt);
    }
    if (extra.durationMs !== undefined) {
      sets.push('duration_ms = ?');
      args.push(Math.round(extra.durationMs));
    }
    if (extra.stage !== undefined) {
      sets.push('processing_stage = ?');
      args.push(extra.stage);
    }
    if (extra.error !== undefined) {
      sets.push('error = ?');
      args.push(extra.error);
    }
    this.db.prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`).run(...args, meetingId);
  }

  rename(p: Principal, meetingId: string, title: string): void {
    this.check(p, meetingId, 'edit_notes');
    tx(this.db, () => {
      this.db
        .prepare('UPDATE meetings SET title = ?, series_key = ?, updated_at = ? WHERE id = ?')
        .run(title, seriesKey(title), this.ts(), meetingId);
      this.indexTitle(meetingId, title);
    });
    this.audit(p, 'note_edited', meetingId, 'title');
  }

  setParticipants(p: Principal, meetingId: string, participants: Participant[]): void {
    this.check(p, meetingId, 'edit_notes');
    tx(this.db, () => {
      this.writeParticipants(meetingId, participants);
      const organizer = participants.find((x) => x.role === 'organizer')?.email ?? null;
      this.db
        .prepare('UPDATE meetings SET organizer_email = ?, updated_at = ? WHERE id = ?')
        .run(organizer, this.ts(), meetingId);
    });
    this.audit(p, 'note_edited', meetingId, 'participants');
  }

  /** Meetings left in capture state by a crash or power loss. */
  interruptedMeetings(p: Principal): string[] {
    const v = this.visibleWhere(p);
    return (
      this.db
        .prepare(`SELECT id FROM meetings m WHERE ${v.sql} AND status IN ('capturing', 'paused')`)
        .all(...v.args) as Row[]
    ).map((r) => String(r.id));
  }

  processingMeetings(p: Principal): string[] {
    const v = this.visibleWhere(p);
    return (
      this.db
        .prepare(`SELECT id FROM meetings m WHERE ${v.sql} AND status = 'processing'`)
        .all(...v.args) as Row[]
    ).map((r) => String(r.id));
  }

  listMeetings(p: Principal): MeetingSummary[] {
    const v = this.visibleWhere(p);
    const rows = this.db
      .prepare(
        `SELECT m.*, n.tldr,
          (SELECT COUNT(*) FROM action_items a WHERE a.meeting_id = m.id AND a.status != 'completed') AS open_tasks,
          (SELECT COUNT(*) FROM decisions d WHERE d.meeting_id = m.id AND d.status = 'confirmed') AS decision_count
         FROM meetings m LEFT JOIN notes n ON n.meeting_id = m.id
         WHERE ${v.sql} ORDER BY m.started_at DESC`,
      )
      .all(...v.args) as Row[];
    return rows.map((r) => this.summary(r));
  }

  private summary(r: Row): MeetingSummary {
    return {
      id: String(r.id),
      title: String(r.title),
      platform: String(r.platform) as Platform,
      status: String(r.status) as MeetingStatus,
      startedAt: String(r.started_at),
      durationMs: num(r.duration_ms),
      isSample: Boolean(r.is_sample),
      tldr: str(r.tldr),
      openTasks: num(r.open_tasks),
      decisions: num(r.decision_count),
    };
  }

  meetingMeta(
    p: Principal,
    meetingId: string,
  ): {
    title: string;
    platform: Platform;
    startedAt: string;
    timeZone: string | null;
    status: MeetingStatus;
    source: string;
    participants: Participant[];
    ownerName: string;
    ownerEmail: string | null;
  } {
    const r = this.check(p, meetingId, 'view_notes');
    return {
      title: String(r.title),
      platform: String(r.platform) as Platform,
      startedAt: String(r.started_at),
      timeZone: str(r.time_zone),
      status: String(r.status) as MeetingStatus,
      source: String(r.source),
      participants: this.participants(meetingId),
      ownerName: this.userName(String(r.owner_id)),
      ownerEmail: str(
        (
          this.db.prepare('SELECT email FROM users WHERE id = ?').get(String(r.owner_id)) as
            Row | undefined
        )?.email,
      ),
    };
  }

  private participants(meetingId: string): Participant[] {
    return (
      this.db
        .prepare('SELECT * FROM participants WHERE meeting_id = ? ORDER BY position')
        .all(meetingId) as Row[]
    ).map((r) => ({
      name: String(r.name),
      email: str(r.email),
      role: String(r.role) as Participant['role'],
    }));
  }

  // ------------------------------------------------------------------ transcript

  /** Append segments as they are transcribed (the crash-safe checkpoint). */
  appendSegments(p: Principal, meetingId: string, segments: TranscriptSegment[]): void {
    if (segments.length === 0) return;
    this.check(p, meetingId, 'edit_notes');
    tx(this.db, () => {
      const ins = this.db.prepare(
        'INSERT OR IGNORE INTO transcript_segments (meeting_id, id, start_ms, end_ms, speaker_id, text, channel) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );
      const idx = this.db.prepare(
        "INSERT INTO search_index (meeting_id, kind, ref, start_ms, text) VALUES (?, 'segment', ?, ?, ?)",
      );
      const spk = this.db.prepare(
        'INSERT OR IGNORE INTO speakers (meeting_id, speaker_id, label) VALUES (?, ?, ?)',
      );
      for (const s of segments) {
        const res = ins.run(
          meetingId,
          s.id,
          Math.round(s.startMs),
          Math.round(s.endMs),
          s.speakerId,
          s.text,
          s.channel ?? null,
        );
        if (Number(res.changes) > 0) idx.run(meetingId, s.id, Math.round(s.startMs), s.text);
        spk.run(meetingId, s.speakerId, s.speaker);
      }
      this.db.prepare('UPDATE meetings SET updated_at = ? WHERE id = ?').run(this.ts(), meetingId);
    });
  }

  addScreenNote(p: Principal, meetingId: string, note: ScreenNote): void {
    this.check(p, meetingId, 'edit_notes');
    this.db
      .prepare(
        'INSERT INTO screen_notes (meeting_id, at_ms, text, window_title) VALUES (?, ?, ?, ?)',
      )
      .run(meetingId, Math.round(note.atMs), note.text, note.windowTitle ?? null);
  }

  screenNotes(p: Principal, meetingId: string): ScreenNote[] {
    this.check(p, meetingId, 'view_transcript');
    return (
      this.db
        .prepare('SELECT * FROM screen_notes WHERE meeting_id = ? ORDER BY at_ms')
        .all(meetingId) as Row[]
    ).map((r) => ({
      atMs: num(r.at_ms),
      text: String(r.text),
      windowTitle: str(r.window_title) ?? undefined,
    }));
  }

  /** Transcript with confirmed speaker names applied. */
  segments(p: Principal, meetingId: string): TranscriptSegment[] {
    this.check(p, meetingId, 'view_transcript');
    return (
      this.db
        .prepare(
          `SELECT s.*, COALESCE(sp.name, sp.label, s.speaker_id) AS speaker
           FROM transcript_segments s LEFT JOIN speakers sp ON sp.meeting_id = s.meeting_id AND sp.speaker_id = s.speaker_id
           WHERE s.meeting_id = ? ORDER BY s.start_ms, s.id`,
        )
        .all(meetingId) as Row[]
    ).map((r) => ({
      id: String(r.id),
      startMs: num(r.start_ms),
      endMs: num(r.end_ms),
      speakerId: String(r.speaker_id),
      speaker: String(r.speaker),
      text: String(r.text),
      channel: (str(r.channel) ?? undefined) as TranscriptSegment['channel'],
    }));
  }

  transcriptHash(p: Principal, meetingId: string): string {
    const segs = this.segments(p, meetingId);
    return hash53(segs.map((s) => `${s.id}|${s.speaker}|${s.text}`).join('\n')) + ':' + segs.length;
  }

  speakers(p: Principal, meetingId: string): SpeakerRow[] {
    this.check(p, meetingId, 'view_transcript');
    return (
      this.db
        .prepare(
          `SELECT sp.*, (SELECT COUNT(*) FROM transcript_segments s WHERE s.meeting_id = sp.meeting_id AND s.speaker_id = sp.speaker_id) AS n
           FROM speakers sp WHERE sp.meeting_id = ? ORDER BY sp.label`,
        )
        .all(meetingId) as Row[]
    ).map((r) => ({
      speakerId: String(r.speaker_id),
      label: String(r.label),
      name: str(r.name),
      segments: num(r.n),
    }));
  }

  /**
   * Apply the end-of-meeting speaker clustering to meeting-audio segments.
   * Speakers are renumbered by first appearance; names already given are kept.
   */
  relabelSpeakers(
    p: Principal,
    meetingId: string,
    labels: { startMs: number; speakerKey: string }[],
  ): void {
    this.check(p, meetingId, 'edit_notes');
    const byStart = new Map(labels.map((l) => [Math.round(l.startMs), l.speakerKey]));
    tx(this.db, () => {
      const rows = this.db
        .prepare(
          "SELECT id, start_ms, speaker_id FROM transcript_segments WHERE meeting_id = ? AND channel = 'system'",
        )
        .all(meetingId) as Row[];
      const named = new Map(
        (
          this.db
            .prepare(
              'SELECT speaker_id, name FROM speakers WHERE meeting_id = ? AND name IS NOT NULL',
            )
            .all(meetingId) as Row[]
        ).map((r) => [String(r.speaker_id), String(r.name)]),
      );
      if (named.size) return; // Never override names a person already chose.
      let changed = 0;
      for (const r of rows) {
        const key = byStart.get(num(r.start_ms));
        if (key && key !== String(r.speaker_id)) {
          this.db
            .prepare(
              'UPDATE transcript_segments SET speaker_id = ? WHERE meeting_id = ? AND id = ?',
            )
            .run(key, meetingId, String(r.id));
          changed++;
        }
      }
      if (!changed) return;
      this.db
        .prepare("DELETE FROM speakers WHERE meeting_id = ? AND speaker_id != 'mic'")
        .run(meetingId);
      const keys = [...new Set(labels.map((l) => l.speakerKey))];
      for (const k of keys)
        this.db
          .prepare(
            'INSERT OR IGNORE INTO speakers (meeting_id, speaker_id, label) VALUES (?, ?, ?)',
          )
          .run(meetingId, k, `Speaker ${k.replace(/^spk-/, '')}`);
    });
  }

  /** "Speaker 2 -> John". Only this meeting; never applied silently elsewhere. */
  renameSpeaker(p: Principal, meetingId: string, speakerId: string, name: string | null): void {
    this.check(p, meetingId, 'edit_notes');
    const res = this.db
      .prepare('UPDATE speakers SET name = ? WHERE meeting_id = ? AND speaker_id = ?')
      .run(name?.trim() || null, meetingId, speakerId);
    if (Number(res.changes) === 0) throw new NotFoundError('That speaker is not in this meeting.');
    this.audit(p, 'note_edited', meetingId, 'speaker');
  }

  // ------------------------------------------------------------------ analysis results

  /**
   * Save analysis output. Idempotent: item ids are stable hashes, user-edited
   * tasks and task statuses survive re-analysis, and nothing is duplicated.
   */
  saveAnalysis(
    p: Principal,
    meetingId: string,
    result: Pick<AnalyzeResult, 'notes' | 'email'>,
    transcriptHash: string,
  ): void {
    this.check(p, meetingId, 'edit_notes');
    const { notes, email } = result;
    const at = this.ts();
    tx(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO notes (meeting_id, tldr, warnings_json, engine_json, generated_at, transcript_hash) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(meeting_id) DO UPDATE SET tldr = excluded.tldr, warnings_json = excluded.warnings_json, engine_json = excluded.engine_json,
             generated_at = excluded.generated_at, transcript_hash = excluded.transcript_hash`,
        )
        .run(
          meetingId,
          notes.tldr,
          JSON.stringify(notes.warnings),
          JSON.stringify(notes.engine),
          notes.generatedAt,
          transcriptHash,
        );

      for (const table of ['topics', 'decisions', 'open_questions', 'risks'])
        this.db.prepare(`DELETE FROM ${table} WHERE meeting_id = ?`).run(meetingId);
      this.db
        .prepare(
          "DELETE FROM search_index WHERE meeting_id = ? AND kind IN ('topic', 'decision', 'action', 'question', 'risk')",
        )
        .run(meetingId);
      const idx = this.db.prepare(
        'INSERT INTO search_index (meeting_id, kind, ref, start_ms, text) VALUES (?, ?, ?, ?, ?)',
      );

      notes.topics.forEach((t, i) => {
        this.db
          .prepare(
            'INSERT INTO topics (meeting_id, id, position, title, summary, evidence_json) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(meetingId, t.id, i, t.title, t.summary, JSON.stringify(t.evidence));
        idx.run(meetingId, 'topic', t.id, t.evidence.startMs, `${t.title}. ${t.summary}`);
      });
      notes.decisions.forEach((d, i) => {
        this.db
          .prepare(
            'INSERT INTO decisions (meeting_id, id, position, text, status, evidence_json) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(meetingId, d.id, i, d.text, d.status, JSON.stringify(d.evidence));
        if (d.status === 'confirmed')
          idx.run(meetingId, 'decision', d.id, d.evidence.startMs, d.text);
      });
      notes.openQuestions.forEach((q, i) => {
        this.db
          .prepare(
            'INSERT INTO open_questions (meeting_id, id, position, question, evidence_json) VALUES (?, ?, ?, ?, ?)',
          )
          .run(meetingId, q.id, i, q.question, JSON.stringify(q.evidence));
        idx.run(meetingId, 'question', q.id, q.evidence.startMs, q.question);
      });
      notes.risks.forEach((r, i) => {
        this.db
          .prepare(
            'INSERT INTO risks (meeting_id, id, position, text, evidence_json) VALUES (?, ?, ?, ?, ?)',
          )
          .run(meetingId, r.id, i, r.text, JSON.stringify(r.evidence));
        idx.run(meetingId, 'risk', r.id, r.evidence.startMs, r.text);
      });

      // Tasks: keep user edits, statuses and manually added tasks.
      const existing = new Map(
        (
          this.db.prepare('SELECT * FROM action_items WHERE meeting_id = ?').all(meetingId) as Row[]
        ).map((r) => [String(r.id), r]),
      );
      const keep = new Set<string>();
      notes.actionItems.forEach((a, i) => {
        keep.add(a.id);
        const prev = existing.get(a.id);
        if (prev && Number(prev.edited)) {
          this.db
            .prepare(
              'UPDATE action_items SET position = ?, evidence_json = ? WHERE meeting_id = ? AND id = ?',
            )
            .run(i, JSON.stringify(a.evidence), meetingId, a.id);
          return;
        }
        this.db
          .prepare(
            `INSERT INTO action_items (meeting_id, id, position, task, owner, deadline_json, due_date, priority, confidence, needs_review, status, evidence_json, source, edited, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', 0, ?)
             ON CONFLICT(meeting_id, id) DO UPDATE SET position = excluded.position, task = excluded.task, owner = excluded.owner,
               deadline_json = excluded.deadline_json, due_date = excluded.due_date, priority = excluded.priority,
               confidence = excluded.confidence, needs_review = excluded.needs_review, evidence_json = excluded.evidence_json, updated_at = excluded.updated_at`,
          )
          .run(
            meetingId,
            a.id,
            i,
            a.task,
            a.owner,
            a.deadline ? JSON.stringify(a.deadline) : null,
            a.deadline?.date ?? null,
            a.priority,
            a.confidence,
            a.needsReview ? 1 : 0,
            prev ? String(prev.status) : a.status,
            JSON.stringify(a.evidence),
            at,
          );
      });
      for (const [id, r] of existing) {
        if (!keep.has(id) && String(r.source) === 'ai' && !Number(r.edited)) {
          this.db
            .prepare('DELETE FROM action_items WHERE meeting_id = ? AND id = ?')
            .run(meetingId, id);
        }
      }
      for (const r of this.db
        .prepare('SELECT id, task, owner FROM action_items WHERE meeting_id = ?')
        .all(meetingId) as Row[]) {
        idx.run(
          meetingId,
          'action',
          String(r.id),
          null,
          `${r.task}${r.owner ? ` (${r.owner})` : ''}`,
        );
      }

      // The email draft is regenerated unless the user edited it.
      const draft = this.db
        .prepare('SELECT edited FROM email_drafts WHERE meeting_id = ?')
        .get(meetingId) as Row | undefined;
      if (!draft || !Number(draft.edited)) {
        this.db
          .prepare(
            `INSERT INTO email_drafts (meeting_id, subject, body, to_json, warnings_json, status, edited, updated_at) VALUES (?, ?, ?, ?, ?, 'draft', 0, ?)
             ON CONFLICT(meeting_id) DO UPDATE SET subject = excluded.subject, body = excluded.body, to_json = excluded.to_json,
               warnings_json = excluded.warnings_json, updated_at = excluded.updated_at`,
          )
          .run(
            meetingId,
            email.subject,
            email.body,
            JSON.stringify(email.to),
            JSON.stringify(email.warnings),
            at,
          );
      }
    });
    this.audit(p, 'meeting_processed', meetingId, notes.engine.kind);
  }

  notes(p: Principal, meetingId: string): (MeetingNotes & { actionItems: TaskRow[] }) | null {
    this.check(p, meetingId, 'view_notes');
    const n = this.db.prepare('SELECT * FROM notes WHERE meeting_id = ?').get(meetingId) as
      Row | undefined;
    if (!n) return null;
    const ev = (r: Row) =>
      json<Evidence>(r.evidence_json, { segmentIds: [], startMs: 0, quote: '' });
    const rows = (sql: string) => this.db.prepare(sql).all(meetingId) as Row[];
    return {
      tldr: String(n.tldr),
      warnings: json<string[]>(n.warnings_json, []),
      engine: json(n.engine_json, { kind: 'rules' as const, promptVersion: '' }),
      generatedAt: String(n.generated_at),
      topics: rows('SELECT * FROM topics WHERE meeting_id = ? ORDER BY position').map<Topic>(
        (r) => ({
          id: String(r.id),
          title: String(r.title),
          summary: String(r.summary),
          evidence: ev(r),
        }),
      ),
      decisions: rows(
        'SELECT * FROM decisions WHERE meeting_id = ? ORDER BY position',
      ).map<Decision>((r) => ({
        id: String(r.id),
        text: String(r.text),
        status: String(r.status) as Decision['status'],
        evidence: ev(r),
      })),
      openQuestions: rows(
        'SELECT * FROM open_questions WHERE meeting_id = ? ORDER BY position',
      ).map<OpenQuestion>((r) => ({
        id: String(r.id),
        question: String(r.question),
        evidence: ev(r),
      })),
      risks: rows('SELECT * FROM risks WHERE meeting_id = ? ORDER BY position').map<Risk>((r) => ({
        id: String(r.id),
        text: String(r.text),
        evidence: ev(r),
      })),
      actionItems: this.taskRows('WHERE a.meeting_id = ?', [meetingId]),
    };
  }

  // ------------------------------------------------------------------ tasks

  private today(timeZone?: string | null): string {
    return toIsoDate(localDate(this.now().toISOString(), timeZone ?? undefined));
  }

  private taskRows(where: string, args: (string | number)[]): TaskRow[] {
    const today = this.today();
    return (
      this.db
        .prepare(
          `SELECT a.*, m.title AS meeting_title, m.started_at AS meeting_date, m.is_sample
           FROM action_items a JOIN meetings m ON m.id = a.meeting_id ${where}
           ORDER BY CASE WHEN a.due_date IS NULL THEN 1 ELSE 0 END, a.due_date, m.started_at DESC, a.position`,
        )
        .all(...args) as Row[]
    ).map((r) => {
      const deadline = json<Deadline | null>(r.deadline_json, null);
      const status = String(r.status) as ActionItem['status'];
      return {
        id: String(r.id),
        task: String(r.task),
        owner: str(r.owner),
        deadline,
        priority: String(r.priority) as ActionItem['priority'],
        confidence: String(r.confidence) as ActionItem['confidence'],
        needsReview: Boolean(r.needs_review),
        status,
        evidence: json<Evidence>(r.evidence_json, { segmentIds: [], startMs: 0, quote: '' }),
        meetingId: String(r.meeting_id),
        meetingTitle: String(r.meeting_title),
        meetingDate: String(r.meeting_date),
        overdue: status !== 'completed' && Boolean(r.due_date) && String(r.due_date) < today,
        edited: Boolean(r.edited),
        isSample: Boolean(r.is_sample),
      };
    });
  }

  listTasks(p: Principal, filter: TaskFilter, me: { name: string }): TaskRow[] {
    const v = this.visibleWhere(p);
    let rows = this.taskRows(`WHERE ${v.sql}`, v.args);
    if (filter.scope === 'mine') {
      const first = me.name.trim().split(/\s+/)[0]?.toLowerCase();
      rows = rows.filter(
        (t) =>
          t.owner &&
          (t.owner.toLowerCase() === me.name.trim().toLowerCase() ||
            t.owner.toLowerCase() === first),
      );
    }
    if (filter.status === 'overdue') return rows.filter((t) => t.overdue);
    if (filter.status === 'open')
      return rows.filter(
        (t) => t.status === 'open' || t.status === 'in_progress' || t.status === 'blocked',
      );
    if (filter.status !== 'all') return rows.filter((t) => t.status === filter.status);
    return rows;
  }

  updateTask(p: Principal, meetingId: string, taskId: string, patch: TaskPatch): TaskRow {
    this.check(p, meetingId, 'edit_tasks');
    const row = this.db
      .prepare('SELECT * FROM action_items WHERE meeting_id = ? AND id = ?')
      .get(meetingId, taskId) as Row | undefined;
    if (!row) throw new NotFoundError('That task no longer exists.');
    const sets: string[] = ['updated_at = ?'];
    const args: (string | number | null)[] = [this.ts()];
    let contentEdit = false;
    if (patch.task !== undefined) {
      sets.push('task = ?');
      args.push(patch.task.trim());
      contentEdit = true;
    }
    if (patch.owner !== undefined) {
      sets.push('owner = ?');
      args.push(patch.owner?.trim() || null);
      contentEdit = true;
    }
    if (patch.deadlineDate !== undefined) {
      const prev = json<Deadline | null>(row.deadline_json, null);
      const deadline: Deadline | null = patch.deadlineDate
        ? {
            phrase: prev?.phrase ?? 'Set by you',
            date: patch.deadlineDate,
            approximate: false,
            needsReview: false,
          }
        : null;
      sets.push('deadline_json = ?', 'due_date = ?');
      args.push(deadline ? JSON.stringify(deadline) : null, deadline?.date ?? null);
      contentEdit = true;
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      args.push(patch.status);
    }
    if (contentEdit) {
      sets.push('edited = 1');
      // Once a person has set the owner and date, the item no longer needs review.
      const owner = patch.owner !== undefined ? patch.owner : str(row.owner);
      sets.push('needs_review = ?');
      args.push(owner ? 0 : 1);
    }
    this.db
      .prepare(`UPDATE action_items SET ${sets.join(', ')} WHERE meeting_id = ? AND id = ?`)
      .run(...args, meetingId, taskId);
    this.audit(p, 'task_edited', meetingId, Object.keys(patch).join(','));
    return this.taskRows('WHERE a.meeting_id = ? AND a.id = ?', [meetingId, taskId])[0]!;
  }

  addTask(p: Principal, meetingId: string, task: string): TaskRow {
    this.check(p, meetingId, 'edit_tasks');
    const id = `action_user_${randomUUID().slice(0, 8)}`;
    const pos = num(
      (
        this.db
          .prepare('SELECT COUNT(*) AS n FROM action_items WHERE meeting_id = ?')
          .get(meetingId) as Row
      ).n,
    );
    this.db
      .prepare(
        `INSERT INTO action_items (meeting_id, id, position, task, owner, priority, confidence, needs_review, status, evidence_json, source, edited, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'medium', 'high', 1, 'open', ?, 'user', 1, ?)`,
      )
      .run(
        meetingId,
        id,
        pos,
        task.trim(),
        JSON.stringify({ segmentIds: [], startMs: 0, quote: '' }),
        this.ts(),
      );
    this.audit(p, 'task_edited', meetingId, 'added');
    return this.taskRows('WHERE a.meeting_id = ? AND a.id = ?', [meetingId, id])[0]!;
  }

  // ------------------------------------------------------------------ email

  emailDraft(p: Principal, meetingId: string): EmailDraftRow | null {
    this.check(p, meetingId, 'draft_email');
    const r = this.db.prepare('SELECT * FROM email_drafts WHERE meeting_id = ?').get(meetingId) as
      Row | undefined;
    if (!r) return null;
    return {
      subject: String(r.subject),
      body: String(r.body),
      to: json(r.to_json, []),
      warnings: json(r.warnings_json, []),
      status: String(r.status) as EmailStatus,
      updatedAt: String(r.updated_at),
    };
  }

  updateEmailDraft(
    p: Principal,
    meetingId: string,
    patch: Partial<Pick<EmailDraftRow, 'subject' | 'body' | 'to'>>,
  ): EmailDraftRow {
    this.check(p, meetingId, 'draft_email');
    const cur = this.emailDraft(p, meetingId);
    if (!cur) throw new NotFoundError('There is no email draft for this meeting yet.');
    const next = { ...cur, ...patch };
    this.db
      .prepare(
        'UPDATE email_drafts SET subject = ?, body = ?, to_json = ?, edited = 1, updated_at = ? WHERE meeting_id = ?',
      )
      .run(next.subject, next.body, JSON.stringify(next.to), this.ts(), meetingId);
    this.audit(p, 'email_drafted', meetingId, 'edited');
    return this.emailDraft(p, meetingId)!;
  }

  setEmailStatus(p: Principal, meetingId: string, status: EmailStatus): void {
    this.check(p, meetingId, status === 'sent' ? 'send_email' : 'draft_email');
    this.db
      .prepare('UPDATE email_drafts SET status = ?, updated_at = ? WHERE meeting_id = ?')
      .run(status, this.ts(), meetingId);
    this.audit(p, status === 'sent' ? 'email_sent' : 'email_drafted', meetingId, status);
  }

  // ------------------------------------------------------------------ detail

  detail(p: Principal, meetingId: string): Omit<MeetingDetail, 'processing'> {
    const r = this.check(p, meetingId, 'view_notes');
    const summary = this.listMeetings(p).find((m) => m.id === meetingId) ?? this.summary(r);
    const canTranscript = (() => {
      try {
        this.check(p, meetingId, 'view_transcript');
        return true;
      } catch {
        return false;
      }
    })();
    const notes = this.notes(p, meetingId);
    return {
      summary,
      timeZone: str(r.time_zone),
      participants: this.participants(meetingId),
      notes,
      segments: canTranscript ? this.segments(p, meetingId) : [],
      speakers: canTranscript ? this.speakers(p, meetingId) : [],
      email: (() => {
        try {
          return this.emailDraft(p, meetingId);
        } catch {
          return null;
        }
      })(),
      recurring: notes ? this.recurring(p, meetingId, r, notes) : null,
      screenNotes: num(
        (
          this.db
            .prepare('SELECT COUNT(*) AS n FROM screen_notes WHERE meeting_id = ?')
            .get(meetingId) as Row
        ).n,
      ),
      hasAudio: false,
    };
  }

  private recurring(
    p: Principal,
    meetingId: string,
    r: Row,
    notes: MeetingNotes,
  ): MeetingDetail['recurring'] {
    const key = str(r.series_key);
    if (!key) return null;
    const v = this.visibleWhere(p);
    const prev = this.db
      .prepare(
        `SELECT m.id, m.title, m.started_at FROM meetings m JOIN notes n ON n.meeting_id = m.id
         WHERE ${v.sql} AND m.series_key = ? AND m.started_at < ? AND m.id != ? ORDER BY m.started_at DESC LIMIT 1`,
      )
      .get(...v.args, key, String(r.started_at), meetingId) as Row | undefined;
    if (!prev) return null;
    const prevNotes = this.notes(p, String(prev.id));
    if (!prevNotes) return null;
    return {
      previous: {
        id: String(prev.id),
        title: String(prev.title),
        startedAt: String(prev.started_at),
      },
      diff: diffMeetings(prevNotes, notes),
    };
  }

  // ------------------------------------------------------------------ search & memory

  search(p: Principal, query: string, limit = 40): SearchHit[] {
    const match = buildFtsQuery(query);
    if (!match) return [];
    const v = this.visibleWhere(p);
    const rows = this.db
      .prepare(
        `SELECT si.meeting_id, si.kind, si.ref, si.start_ms, snippet(search_index, 4, char(1), char(2), '…', 14) AS snip, m.title, m.started_at, m.is_sample
         FROM search_index si JOIN meetings m ON m.id = si.meeting_id
         WHERE search_index MATCH ? AND ${v.sql}
         ORDER BY bm25(search_index), m.started_at DESC LIMIT ?`,
      )
      .all(match, ...v.args, limit) as Row[];
    return rows.map((r) => ({
      meetingId: String(r.meeting_id),
      meetingTitle: String(r.title),
      startedAt: String(r.started_at),
      kind: String(r.kind) as SearchHit['kind'],
      snippet: String(r.snip),
      startMs: r.start_ms === null || r.start_ms === undefined ? null : num(r.start_ms),
      isSample: Boolean(r.is_sample),
    }));
  }

  /** Meetings for Q&A: notes for all visible meetings, transcripts only where they matched the query. */
  memory(p: Principal, query: string): MemoryMeeting[] {
    const v = this.visibleWhere(p);
    const matched = new Set(this.search(p, query, 200).map((h) => h.meetingId));
    const rows = this.db
      .prepare(
        `SELECT m.id, m.title, m.started_at, m.time_zone FROM meetings m WHERE ${v.sql} ORDER BY m.started_at DESC LIMIT 500`,
      )
      .all(...v.args) as Row[];
    return rows.map((r) => {
      const id = String(r.id);
      return {
        id,
        title: String(r.title),
        startedAt: String(r.started_at),
        timeZone: str(r.time_zone) ?? undefined,
        notes: this.notes(p, id),
        segments: matched.has(id) ? this.segments(p, id) : [],
      };
    });
  }

  // ------------------------------------------------------------------ deletion & retention

  deleteMeeting(p: Principal, meetingId: string): void {
    this.check(p, meetingId, 'delete_meeting');
    tx(this.db, () => {
      this.db.prepare('DELETE FROM search_index WHERE meeting_id = ?').run(meetingId);
      this.db.prepare('DELETE FROM meetings WHERE id = ?').run(meetingId);
    });
    this.audit(p, 'meeting_deleted', meetingId, null);
  }

  /** Remove the transcript and every verbatim quote, keep the structured notes. */
  deleteTranscript(p: Principal, meetingId: string): void {
    this.check(p, meetingId, 'delete_meeting');
    tx(this.db, () => {
      this.db.prepare('DELETE FROM transcript_segments WHERE meeting_id = ?').run(meetingId);
      this.db.prepare('DELETE FROM screen_notes WHERE meeting_id = ?').run(meetingId);
      this.db
        .prepare("DELETE FROM search_index WHERE meeting_id = ? AND kind = 'segment'")
        .run(meetingId);
      for (const table of ['topics', 'decisions', 'action_items', 'open_questions', 'risks']) {
        const rows = this.db
          .prepare(`SELECT id, evidence_json FROM ${table} WHERE meeting_id = ?`)
          .all(meetingId) as Row[];
        for (const r of rows) {
          const e = json<Evidence>(r.evidence_json, { segmentIds: [], startMs: 0, quote: '' });
          this.db
            .prepare(`UPDATE ${table} SET evidence_json = ? WHERE meeting_id = ? AND id = ?`)
            .run(JSON.stringify({ ...e, quote: '' }), meetingId, String(r.id));
        }
      }
    });
    this.audit(p, 'transcript_deleted', meetingId, null);
  }

  meetingsOlderThan(p: Principal, days: number): string[] {
    if (!days) return [];
    const cutoff = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    const v = this.visibleWhere(p);
    return (
      this.db
        .prepare(
          `SELECT id FROM meetings m WHERE ${v.sql} AND m.started_at < ? AND m.status NOT IN ('capturing', 'paused', 'processing')`,
        )
        .all(...v.args, cutoff) as Row[]
    ).map((r) => String(r.id));
  }

  sampleMeetingIds(p: Principal): string[] {
    const v = this.visibleWhere(p);
    return (
      this.db
        .prepare(`SELECT id FROM meetings m WHERE ${v.sql} AND m.is_sample = 1`)
        .all(...v.args) as Row[]
    ).map((r) => String(r.id));
  }

  deleteAll(p: Principal): void {
    const v = this.visibleWhere(p);
    const ids = (
      this.db.prepare(`SELECT id FROM meetings m WHERE ${v.sql}`).all(...v.args) as Row[]
    ).map((r) => String(r.id));
    tx(this.db, () => {
      for (const id of ids) {
        this.db.prepare('DELETE FROM search_index WHERE meeting_id = ?').run(id);
        this.db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
      }
      this.db.prepare('DELETE FROM ai_cache').run();
    });
    this.audit(p, 'all_data_deleted', null, String(ids.length));
  }

  // ------------------------------------------------------------------ jobs, cache, settings, audit

  /** Returns false when an identical job already exists (idempotent processing). */
  enqueueJob(meetingId: string, kind: string, key: string): boolean {
    const at = this.ts();
    const res = this.db
      .prepare(
        "INSERT OR IGNORE INTO jobs (id, meeting_id, kind, key, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)",
      )
      .run(randomUUID(), meetingId, kind, key, at, at);
    return Number(res.changes) > 0;
  }

  job(key: string): { status: string; attempts: number } | null {
    const r = this.db.prepare('SELECT status, attempts FROM jobs WHERE key = ?').get(key) as
      Row | undefined;
    return r ? { status: String(r.status), attempts: num(r.attempts) } : null;
  }

  setJob(key: string, status: 'pending' | 'running' | 'done' | 'failed', error?: string): void {
    this.db
      .prepare(
        "UPDATE jobs SET status = ?, attempts = attempts + (CASE WHEN ? = 'running' THEN 1 ELSE 0 END), last_error = ?, updated_at = ? WHERE key = ?",
      )
      .run(status, status, error ?? null, this.ts(), key);
  }

  deleteJobs(meetingId: string): void {
    this.db.prepare('DELETE FROM jobs WHERE meeting_id = ?').run(meetingId);
  }

  cacheGet(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM ai_cache WHERE key = ?').get(key) as
      Row | undefined;
    return r ? String(r.value) : undefined;
  }

  cacheSet(key: string, value: string): void {
    this.db
      .prepare('INSERT OR REPLACE INTO ai_cache (key, value, created_at) VALUES (?, ?, ?)')
      .run(key, value, this.ts());
  }

  getSetting(key: string): string | undefined {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      Row | undefined;
    return r ? String(r.value) : undefined;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  /** Audit trail of important actions. Never stores content, only ids and short tags. */
  audit(
    p: Principal | null,
    action: string,
    meetingId: string | null,
    detail: string | null,
  ): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (at, actor_id, action, meeting_id, detail) VALUES (?, ?, ?, ?, ?)',
      )
      .run(this.ts(), p?.userId ?? null, action, meetingId, detail);
  }

  auditLog(limit = 200): {
    at: string;
    actor: string | null;
    action: string;
    meetingId: string | null;
    detail: string | null;
  }[] {
    return (
      this.db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as Row[]
    ).map((r) => ({
      at: String(r.at),
      actor: str(r.actor_id),
      action: String(r.action),
      meetingId: str(r.meeting_id),
      detail: str(r.detail),
    }));
  }
}
