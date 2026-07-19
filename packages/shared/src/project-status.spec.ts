import { describe, expect, it } from 'vitest';
import { deriveProjectStatus } from './project-status';

describe('deriveProjectStatus', () => {
  it('is EMPTY when there are no active jobs', () => {
    expect(deriveProjectStatus([])).toBe('EMPTY');
    expect(deriveProjectStatus(['ARCHIVED', 'ARCHIVED'])).toBe('EMPTY');
  });

  it('is RESERVATION when all jobs are reservations', () => {
    expect(deriveProjectStatus(['RESERVATION', 'RESERVATION'])).toBe('RESERVATION');
  });

  it('is PARTIALLY_APPROVED when some are approved and others reserved', () => {
    expect(deriveProjectStatus(['APPROVED', 'RESERVATION'])).toBe('PARTIALLY_APPROVED');
  });

  it('is APPROVED when all active jobs are approved', () => {
    expect(deriveProjectStatus(['APPROVED', 'APPROVED', 'ARCHIVED'])).toBe('APPROVED');
  });

  it('is IN_PROGRESS when some completed and some still active', () => {
    expect(deriveProjectStatus(['COMPLETED', 'APPROVED'])).toBe('IN_PROGRESS');
    expect(deriveProjectStatus(['COMPLETED', 'RESERVATION'])).toBe('IN_PROGRESS');
  });

  it('is COMPLETED when all active jobs are completed', () => {
    expect(deriveProjectStatus(['COMPLETED', 'COMPLETED', 'ARCHIVED'])).toBe('COMPLETED');
  });
});
