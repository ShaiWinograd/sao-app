import { describe, expect, it } from 'vitest';
import {
  estimateWorkerHours,
  plannedComponentsForServiceSelection,
} from './planned-services';

describe('plannedComponentsForServiceSelection', () => {
  it('plans packing and unpacking for a moving project, without organizing', () => {
    expect(plannedComponentsForServiceSelection('MOVING')).toEqual(['PACKING', 'UNPACKING']);
  });

  it('maps single-service selections directly', () => {
    expect(plannedComponentsForServiceSelection('PACKING')).toEqual(['PACKING']);
    expect(plannedComponentsForServiceSelection('UNPACKING')).toEqual(['UNPACKING']);
    expect(plannedComponentsForServiceSelection('ORGANIZATION')).toEqual(['HOME_ORGANIZATION']);
  });
});

describe('estimateWorkerHours', () => {
  it('multiplies workdays, workers, and hours', () => {
    expect(estimateWorkerHours({ estimatedWorkdays: 2, workersPerDay: 4, hoursPerDay: 5 })).toBe(40);
  });

  it('returns 0 when any input is missing', () => {
    expect(estimateWorkerHours({ estimatedWorkdays: 2, workersPerDay: 4 })).toBe(0);
    expect(estimateWorkerHours({})).toBe(0);
  });

  it('returns 0 for non-positive inputs', () => {
    expect(estimateWorkerHours({ estimatedWorkdays: 0, workersPerDay: 4, hoursPerDay: 5 })).toBe(0);
    expect(estimateWorkerHours({ estimatedWorkdays: -1, workersPerDay: 4, hoursPerDay: 5 })).toBe(0);
  });

  it('supports fractional hours per day', () => {
    expect(estimateWorkerHours({ estimatedWorkdays: 1, workersPerDay: 3, hoursPerDay: 4.5 })).toBe(13.5);
  });
});
