import { describe, expect, it } from 'vitest';
import {
  shouldMonitor,
  canMonitor,
  classifyReading,
  reduceReading,
  applyServerExit,
  reconcileFromServer,
  initialMonitorState,
  countdownRemainingMs,
  isCountdownExpired,
  type MonitorState,
  type Reading,
} from './attendanceMonitor';

const JOB = { latitude: 32.0, longitude: 34.8 };
const NOW = Date.parse('2026-08-01T10:00:00.000Z');
const RADIUS = 500;

// ~2.2 km north of the job → clearly outside; same point → inside.
const outsideReading = (over: Partial<Reading> = {}): Reading => ({ latitude: 32.02, longitude: 34.8, accuracy: 15, timestamp: NOW, ...over });
const insideReading = (over: Partial<Reading> = {}): Reading => ({ latitude: 32.0, longitude: 34.8, accuracy: 15, timestamp: NOW, ...over });

describe('monitoring lifecycle', () => {
  it('monitors only while clocked in', () => {
    expect(shouldMonitor('CLOCKED_IN')).toBe(true);
    for (const s of ['SCHEDULED', 'PROPOSED', 'CLOCKED_OUT', 'AUTO_CLOCKED_OUT', 'NO_SHOW', 'CORRECTED']) {
      expect(shouldMonitor(s)).toBe(false);
    }
  });

  it('does not monitor without permission or job coordinates (owner-review fallback)', () => {
    expect(canMonitor({ hasForegroundPermission: true, jobCoords: JOB })).toBe(true);
    expect(canMonitor({ hasForegroundPermission: false, jobCoords: JOB })).toBe(false);
    expect(canMonitor({ hasForegroundPermission: true, jobCoords: null })).toBe(false);
  });
});

describe('reading classification (noise/stale rejection)', () => {
  it('ignores low-accuracy fixes', () => {
    expect(classifyReading(outsideReading({ accuracy: 250 }), JOB, RADIUS, NOW)).toBe('ignore');
  });
  it('ignores stale fixes', () => {
    expect(classifyReading(outsideReading({ timestamp: NOW - 10 * 60_000 }), JOB, RADIUS, NOW)).toBe('ignore');
  });
  it('classifies clear inside/outside', () => {
    expect(classifyReading(insideReading(), JOB, RADIUS, NOW)).toBe('inside');
    expect(classifyReading(outsideReading(), JOB, RADIUS, NOW)).toBe('outside');
  });
});

describe('exit detection', () => {
  it('a single noisy/outdated reading never triggers an exit', () => {
    let state = initialMonitorState();
    const r1 = reduceReading(state, outsideReading({ accuracy: 300 }), JOB, RADIUS, NOW);
    expect(r1.action).toBe('NONE');
    expect(r1.state.phase).toBe('inside');
    const r2 = reduceReading(r1.state, outsideReading({ timestamp: NOW - 10 * 60_000 }), JOB, RADIUS, NOW);
    expect(r2.action).toBe('NONE');
  });

  it('requires two consecutive confirmed outside readings, then sends exit once', () => {
    let state = initialMonitorState();
    const first = reduceReading(state, outsideReading(), JOB, RADIUS, NOW);
    expect(first.action).toBe('NONE'); // one confirmation only
    const second = reduceReading(first.state, outsideReading(), JOB, RADIUS, NOW);
    expect(second.action).toBe('SEND_EXIT');
    expect(second.state.phase).toBe('pendingExit');
    // Further outside readings while pending must NOT resend.
    const third = reduceReading(second.state, outsideReading(), JOB, RADIUS, NOW);
    expect(third.action).toBe('NONE');
  });

  it('a single inside reading between outs resets the confirmation count', () => {
    let state = initialMonitorState();
    const a = reduceReading(state, outsideReading(), JOB, RADIUS, NOW);
    const b = reduceReading(a.state, insideReading(), JOB, RADIUS, NOW);
    const c = reduceReading(b.state, outsideReading(), JOB, RADIUS, NOW);
    expect(c.action).toBe('NONE'); // count restarted, only one out again
  });
});

describe('return detection', () => {
  it('returning inside before the deadline clears the pending exit and sends return', () => {
    let state: MonitorState = applyServerExit(initialMonitorState(), NOW + 15 * 60_000);
    expect(state.phase).toBe('pendingExit');
    const r = reduceReading(state, insideReading(), JOB, RADIUS, NOW + 3 * 60_000);
    expect(r.action).toBe('SEND_RETURN');
    expect(r.state.phase).toBe('inside');
    expect(r.state.serverExitDeadline).toBeNull();
  });
});

describe('countdown from server deadline', () => {
  it('computes remaining time and expiry from the server deadline', () => {
    const deadline = NOW + 15 * 60_000;
    expect(countdownRemainingMs(deadline, NOW)).toBe(15 * 60_000);
    expect(countdownRemainingMs(deadline, NOW + 20 * 60_000)).toBe(0);
    expect(isCountdownExpired(deadline, NOW + 5 * 60_000)).toBe(false);
    expect(isCountdownExpired(deadline, deadline)).toBe(true);
    expect(isCountdownExpired(null, NOW)).toBe(false);
  });
});

describe('server reconciliation (restart / foreground / manual-clock-out race)', () => {
  it('restores an active session with a pending-exit countdown after restart', () => {
    const deadline = '2026-08-01T10:15:00.000Z';
    const r = reconcileFromServer({ attendanceStatus: 'CLOCKED_IN', areaExitDeadline: deadline });
    expect(r.monitor).toBe(true);
    expect(r.state?.phase).toBe('pendingExit');
    expect(r.state?.serverExitDeadline).toBe(Date.parse(deadline));
  });

  it('restores an active session with no pending exit', () => {
    const r = reconcileFromServer({ attendanceStatus: 'CLOCKED_IN', areaExitDeadline: null });
    expect(r.monitor).toBe(true);
    expect(r.state?.phase).toBe('inside');
  });

  it('stops monitoring when the server already auto-clocked-out (race with manual clock-out)', () => {
    expect(reconcileFromServer({ attendanceStatus: 'AUTO_CLOCKED_OUT' })).toEqual({ monitor: false, state: null });
    expect(reconcileFromServer({ attendanceStatus: 'CLOCKED_OUT' })).toEqual({ monitor: false, state: null });
  });
});
