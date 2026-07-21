import { describe, expect, it } from 'vitest';
import {
  selectCaseForJob,
  isJobDateInCaseWindow,
  caseRangeFromJobDates,
  resolveCaseReopenDays,
  CASE_REOPEN_DAYS_DEFAULT,
  type GroupingCandidate,
} from './case-grouping';

const DAY = 86_400_000;
const BASE = new Date('2026-01-01T00:00:00.000Z').getTime();
const at = (n: number) => new Date(BASE + n * DAY);

function candidate(caseId: string, min: number, max: number): GroupingCandidate {
  return { caseId, earliestJobDate: at(min), latestJobDate: at(max) };
}

describe('case-grouping rule (§18.12)', () => {
  it('groups a job within the window into the same ACTIVE case', () => {
    const d = selectCaseForJob(at(30), [candidate('c1', 0, 0)]);
    expect(d.chosenCaseId).toBe('c1');
    expect(d.anomaly).toBe(false);
  });

  it('includes a job exactly CASE_REOPEN_DAYS after the latest job date', () => {
    const d = selectCaseForJob(at(60), [candidate('c1', 0, 0)]);
    expect(d.chosenCaseId).toBe('c1');
  });

  it('creates a new case when the job is 61 days from the nearest case job', () => {
    const d = selectCaseForJob(at(61), [candidate('c1', 0, 0)]);
    expect(d.chosenCaseId).toBeNull();
  });

  it('groups a job earlier than an existing future job but within the range', () => {
    // Case has a future job at day 100; a new job at day 50 is within [40, 160].
    const d = selectCaseForJob(at(50), [candidate('c1', 100, 100)]);
    expect(d.chosenCaseId).toBe('c1');
  });

  it('supports rolling grouping via range expansion', () => {
    // Case [0, 50]; a day-100 job is within 60 of the latest (50) → same case.
    expect(selectCaseForJob(at(100), [candidate('c1', 0, 50)]).chosenCaseId).toBe('c1');
    // After that job the range is [0, 100]; a day-160 job is on the boundary.
    expect(selectCaseForJob(at(160), [candidate('c1', 0, 100)]).chosenCaseId).toBe('c1');
    // day-161 is out.
    expect(selectCaseForJob(at(161), [candidate('c1', 0, 100)]).chosenCaseId).toBeNull();
  });

  it('uses only the job-date range bounds, inclusive on both sides', () => {
    const range = { earliestJobDate: at(0), latestJobDate: at(0) };
    expect(isJobDateInCaseWindow(at(60), range)).toBe(true); // latest + window
    expect(isJobDateInCaseWindow(at(61), range)).toBe(false);
    expect(isJobDateInCaseWindow(at(-60), range)).toBe(true); // earliest - window
    expect(isJobDateInCaseWindow(at(-61), range)).toBe(false);
  });

  it('picks the closest range when multiple cases are eligible (anomaly)', () => {
    // A [0,0] (dist 55), B [100,100] (dist 45) — both eligible, B is closer.
    const d = selectCaseForJob(at(55), [candidate('A', 0, 0), candidate('B', 100, 100)]);
    expect(d.eligibleCaseIds.sort()).toEqual(['A', 'B']);
    expect(d.chosenCaseId).toBe('B');
    expect(d.anomaly).toBe(true);
  });

  it('breaks ties by the most recent latestJobDate', () => {
    // A [0,0] and B [110,110] are both exactly 55 from a day-55 job → tie → B.
    const d = selectCaseForJob(at(55), [candidate('A', 0, 0), candidate('B', 110, 110)]);
    expect(d.chosenCaseId).toBe('B');
    expect(d.anomaly).toBe(true);
  });

  it('returns no case (new case) when there are no candidates', () => {
    const d = selectCaseForJob(at(10), []);
    expect(d.chosenCaseId).toBeNull();
    expect(d.anomaly).toBe(false);
  });

  it('derives a range from job dates', () => {
    expect(caseRangeFromJobDates([at(5), at(1), at(9)])).toEqual({ earliestJobDate: at(1), latestJobDate: at(9) });
    expect(caseRangeFromJobDates([])).toBeNull();
  });

  it('validates CASE_REOPEN_DAYS as a positive integer with a default', () => {
    expect(resolveCaseReopenDays('30')).toBe(30);
    expect(resolveCaseReopenDays('0')).toBe(CASE_REOPEN_DAYS_DEFAULT);
    expect(resolveCaseReopenDays('-5')).toBe(CASE_REOPEN_DAYS_DEFAULT);
    expect(resolveCaseReopenDays('abc')).toBe(CASE_REOPEN_DAYS_DEFAULT);
    expect(resolveCaseReopenDays(undefined)).toBe(CASE_REOPEN_DAYS_DEFAULT);
    expect(resolveCaseReopenDays(45)).toBe(45);
  });
});
