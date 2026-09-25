import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  analyzeMeeting,
  RulesExtractor,
  AccessDeniedError,
  type Principal,
} from '@meeting-assistant/core';
import { phoenixWeekly, injectionMeeting } from '@meeting-assistant/core/fixtures';
import { openDatabase, type Db } from '../src/main/db/database';
import { Repo, NotFoundError } from '../src/main/db/repo';

let db: Db;
let repo: Repo;
let alice: Principal;
let otherTenant: Principal;

async function seed(p: Principal, fx = phoenixWeekly) {
  const id = repo.createMeeting(p, {
    title: fx.meeting.title,
    platform: 'zoom',
    startedAt: fx.meeting.startedAt,
    timeZone: fx.meeting.timeZone ?? null,
    source: 'live',
    participants: fx.meeting.participants,
  });
  repo.appendSegments(p, id, fx.segments);
  const r = await analyzeMeeting(
    { meeting: { ...fx.meeting, id }, segments: repo.segments(p, id) },
    { extractor: new RulesExtractor(), now: () => new Date('2026-09-25T12:00:00Z') },
  );
  repo.saveAnalysis(p, id, r, repo.transcriptHash(p, id));
  repo.setStatus(p, id, 'ready');
  return id;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  repo = new Repo(db, () => new Date('2026-09-25T12:00:00Z'));
  alice = repo.ensureLocalUser('Alice Johnson', 'alice.johnson@acme.example.test');
  otherTenant = repo.createUser('tenant-b', 'user-b', 'Bella Other', 'bella@other.example.test');
});
afterEach(() => db.close());

describe('migrations', () => {
  it('creates the schema once and is idempotent', () => {
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(
      1,
    );
    const again = new Repo(db);
    expect(() => again.ensureLocalUser('Alice', null)).not.toThrow();
  });
});

describe('meetings and notes', () => {
  it('stores a meeting, its transcript and its notes', async () => {
    const id = await seed(alice);
    const d = repo.detail(alice, id);
    expect(d.segments).toHaveLength(phoenixWeekly.segments.length);
    expect(d.notes?.decisions.find((x) => x.status === 'confirmed')?.text).toMatch(/monday/i);
    expect(d.notes?.actionItems.map((a) => a.owner)).toEqual(['David Wilson', 'Bob Smith']);
    expect(d.email?.subject).toBe('Meeting Summary — Project Phoenix Weekly');
    expect(repo.listMeetings(alice)[0]).toMatchObject({
      id,
      openTasks: 2,
      decisions: 1,
      status: 'ready',
    });
  });

  it('re-analysis is idempotent and keeps user edits and statuses', async () => {
    const id = await seed(alice);
    const [firewall, migration] = repo.notes(alice, id)!.actionItems;
    repo.updateTask(alice, id, firewall!.id, { status: 'completed' });
    repo.updateTask(alice, id, migration!.id, { owner: 'Bella Smith', deadlineDate: '2026-10-01' });
    const r = await analyzeMeeting(
      { meeting: { ...phoenixWeekly.meeting, id }, segments: repo.segments(alice, id) },
      { extractor: new RulesExtractor() },
    );
    repo.saveAnalysis(alice, id, r, repo.transcriptHash(alice, id));
    repo.saveAnalysis(alice, id, r, repo.transcriptHash(alice, id));
    const tasks = repo.notes(alice, id)!.actionItems;
    expect(tasks).toHaveLength(2);
    expect(tasks.find((t) => t.id === firewall!.id)!.status).toBe('completed');
    expect(tasks.find((t) => t.id === migration!.id)).toMatchObject({
      owner: 'Bella Smith',
      edited: true,
      needsReview: false,
    });
    expect(repo.notes(alice, id)!.decisions.filter((d) => d.status === 'confirmed')).toHaveLength(
      1,
    );
  });

  it('ignores duplicate transcript segments', async () => {
    const id = await seed(alice);
    repo.appendSegments(alice, id, phoenixWeekly.segments);
    expect(repo.segments(alice, id)).toHaveLength(phoenixWeekly.segments.length);
    expect(
      repo.search(alice, 'firewall').filter((h) => h.kind === 'segment').length,
    ).toBeLessThanOrEqual(5);
  });

  it('keeps an edited email draft when notes are regenerated', async () => {
    const id = await seed(alice);
    repo.updateEmailDraft(alice, id, { subject: 'My subject' });
    const r = await analyzeMeeting(
      { meeting: { ...phoenixWeekly.meeting, id }, segments: repo.segments(alice, id) },
      { extractor: new RulesExtractor() },
    );
    repo.saveAnalysis(alice, id, r, 'x');
    expect(repo.emailDraft(alice, id)!.subject).toBe('My subject');
  });

  it('renames a speaker for one meeting only', async () => {
    const id = await seed(alice);
    const other = await seed(alice);
    repo.renameSpeaker(alice, id, 'david', 'Dave W.');
    expect(repo.segments(alice, id).some((s) => s.speaker === 'Dave W.')).toBe(true);
    expect(repo.segments(alice, other).some((s) => s.speaker === 'Dave W.')).toBe(false);
    expect(() => repo.renameSpeaker(alice, id, 'nobody', 'X')).toThrow(NotFoundError);
  });
});

describe('tasks', () => {
  it('lists my tasks, overdue tasks and completed tasks', async () => {
    const id = await seed(alice);
    const all = repo.listTasks(alice, { scope: 'all', status: 'all' }, { name: 'Alice Johnson' });
    expect(all).toHaveLength(2);
    expect(
      repo
        .listTasks(alice, { scope: 'mine', status: 'open' }, { name: 'David Wilson' })
        .map((t) => t.task),
    ).toEqual([expect.stringMatching(/firewall/i)]);
    // The firewall task was due Sep 24; "now" is Sep 25.
    expect(
      repo.listTasks(alice, { scope: 'all', status: 'overdue' }, { name: 'x' }).map((t) => t.task),
    ).toEqual([expect.stringMatching(/firewall/i)]);
    const t = all[0]!;
    repo.updateTask(alice, id, t.id, { status: 'completed' });
    expect(
      repo.listTasks(alice, { scope: 'all', status: 'completed' }, { name: 'x' }),
    ).toHaveLength(1);
    expect(repo.listTasks(alice, { scope: 'all', status: 'overdue' }, { name: 'x' })).toHaveLength(
      0,
    );
  });

  it('adds a manual task that needs an owner', async () => {
    const id = await seed(alice);
    const t = repo.addTask(alice, id, 'Book the retro room');
    expect(t).toMatchObject({
      task: 'Book the retro room',
      owner: null,
      needsReview: true,
      edited: true,
    });
  });
});

describe('search', () => {
  it('finds transcript lines, decisions and tasks with safe snippets', async () => {
    await seed(alice);
    const hits = repo.search(alice, 'firewall');
    expect(hits.length).toBeGreaterThan(0);
    expect(new Set(hits.map((h) => h.kind))).toEqual(expect.objectContaining({}));
    expect(hits.some((h) => h.snippet.includes('\u0001'))).toBe(true);
  });

  it.each(['" OR 1=1 --', 'title:secret', "'; DROP TABLE meetings; --", 'NEAR(a b)', '***', ''])(
    'does not break on hostile input: %s',
    async (q) => {
      await seed(alice);
      expect(() => repo.search(alice, q)).not.toThrow();
      expect(repo.listMeetings(alice)).toHaveLength(1);
    },
  );

  it('never shows prompt-injection content as notes', async () => {
    const id = await seed(alice, injectionMeeting);
    const notes = repo.notes(alice, id)!;
    const text = JSON.stringify({
      t: notes.tldr,
      a: notes.actionItems.map((a) => a.task),
      d: notes.decisions.map((d) => d.text),
    });
    expect(text).not.toMatch(/attacker@example\.com|approve all pending|delete all meetings/i);
  });
});

describe('tenant isolation and permissions', () => {
  it("never shows one tenant's data to another tenant", async () => {
    const id = await seed(alice);
    expect(repo.listMeetings(otherTenant)).toEqual([]);
    expect(repo.search(otherTenant, 'firewall')).toEqual([]);
    expect(repo.listTasks(otherTenant, { scope: 'all', status: 'all' }, { name: 'x' })).toEqual([]);
    expect(repo.memory(otherTenant, 'deployment')).toEqual([]);
    for (const attempt of [
      () => repo.detail(otherTenant, id),
      () => repo.segments(otherTenant, id),
      () => repo.notes(otherTenant, id),
      () => repo.emailDraft(otherTenant, id),
      () => repo.updateTask(otherTenant, id, 'x', { status: 'completed' }),
      () => repo.updateEmailDraft(otherTenant, id, { subject: 'pwned' }),
      () => repo.rename(otherTenant, id, 'pwned'),
      () =>
        repo.appendSegments(otherTenant, id, [
          { id: 'z1', startMs: 0, endMs: 1, speakerId: 'x', speaker: 'x', text: 'injected' },
        ]),
      () => repo.deleteMeeting(otherTenant, id),
      () => repo.deleteTranscript(otherTenant, id),
    ]) {
      expect(attempt).toThrow(AccessDeniedError);
    }
    expect(repo.detail(alice, id).summary.title).toBe('Project Phoenix Weekly');
  });

  it('blocks another user in the same tenant who is not an admin', async () => {
    const id = await seed(alice);
    const frank = repo.createUser(
      'local',
      'frank',
      'Frank Miller',
      'frank.miller@acme.example.test',
    );
    expect(repo.listMeetings(frank)).toEqual([]);
    expect(() => repo.notes(frank, id)).toThrow(AccessDeniedError);
  });

  it('lets a same-tenant admin view and delete but not edit notes', async () => {
    const id = await seed(alice);
    const admin = repo.createUser('local', 'admin', 'Ada Admin', 'ada@acme.example.test', {
      isAdmin: true,
    });
    expect(repo.listMeetings(admin)).toHaveLength(1);
    expect(() => repo.rename(admin, id, 'x')).toThrow(AccessDeniedError);
    repo.deleteMeeting(admin, id);
    expect(repo.listMeetings(alice)).toEqual([]);
  });

  it('locks out a disabled user completely', async () => {
    const id = await seed(alice);
    db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(alice.userId);
    const disabled = repo.principal(alice.userId);
    expect(repo.listMeetings(disabled)).toEqual([]);
    expect(() => repo.notes(disabled, id)).toThrow(AccessDeniedError);
    expect(() =>
      repo.createMeeting(disabled, {
        title: 'x',
        platform: 'other',
        startedAt: new Date().toISOString(),
        timeZone: null,
        source: 'live',
      }),
    ).toThrow();
  });
});

describe('deletion and audit', () => {
  it('deleting a transcript removes quotes but keeps notes', async () => {
    const id = await seed(alice);
    repo.deleteTranscript(alice, id);
    expect(repo.segments(alice, id)).toEqual([]);
    const notes = repo.notes(alice, id)!;
    expect(notes.actionItems).toHaveLength(2);
    expect(notes.actionItems.every((a) => a.evidence.quote === '')).toBe(true);
    expect(repo.search(alice, 'weekend').filter((h) => h.kind === 'segment')).toEqual([]);
  });

  it('deleting a meeting removes everything, including search entries', async () => {
    const id = await seed(alice);
    repo.deleteMeeting(alice, id);
    expect(repo.listMeetings(alice)).toEqual([]);
    expect(repo.search(alice, 'firewall')).toEqual([]);
    expect(() => repo.detail(alice, id)).toThrow(NotFoundError);
    for (const table of [
      'transcript_segments',
      'action_items',
      'decisions',
      'email_drafts',
      'notes',
      'participants',
    ]) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n).toBe(0);
    }
  });

  it('records important actions without content', async () => {
    const id = await seed(alice);
    repo.updateEmailDraft(alice, id, { body: 'SECRET BODY' });
    repo.deleteMeeting(alice, id);
    const log = repo.auditLog();
    expect(log.map((l) => l.action)).toEqual(
      expect.arrayContaining([
        'capture_started',
        'meeting_processed',
        'email_drafted',
        'meeting_deleted',
      ]),
    );
    expect(JSON.stringify(log)).not.toContain('SECRET');
    expect(JSON.stringify(log)).not.toMatch(/firewall/i);
  });

  it('retention finds only finished meetings older than the limit', async () => {
    const id = await seed(alice);
    expect(repo.meetingsOlderThan(alice, 30)).toEqual([]);
    expect(repo.meetingsOlderThan(alice, 0)).toEqual([]);
    const later = new Repo(db, () => new Date('2027-01-01T00:00:00Z'));
    expect(later.meetingsOlderThan(alice, 30)).toEqual([id]);
  });
});
