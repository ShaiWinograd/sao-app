export type ServiceType = 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';

export type ServiceTimingPrecision =
  | 'EXACT_DATE'
  | 'MULTIPLE_EXACT_DATES'
  | 'DATE_RANGE'
  | 'EXPECTED_MONTH'
  | 'EXPECTED_YEAR'
  | 'UNKNOWN';

// High-level service the customer selects in the project wizard.
export type ServiceSelection = 'PACKING' | 'UNPACKING' | 'ORGANIZATION' | 'MOVING';

export type WorkEstimateInput = {
  estimatedWorkdays?: number | null;
  workersPerDay?: number | null;
  hoursPerDay?: number | null;
};

// Selecting "moving" (מעבר דירה) plans packing + unpacking, never organizing.
export function plannedComponentsForServiceSelection(selection: ServiceSelection): ServiceType[] {
  switch (selection) {
    case 'MOVING':
      return ['PACKING', 'UNPACKING'];
    case 'PACKING':
      return ['PACKING'];
    case 'UNPACKING':
      return ['UNPACKING'];
    case 'ORGANIZATION':
      return ['HOME_ORGANIZATION'];
    default:
      return [];
  }
}

// Estimated worker-hours = workdays × workers/day × hours/day. Missing or
// non-positive inputs yield 0 (nothing meaningful to estimate yet).
export function estimateWorkerHours(input: WorkEstimateInput): number {
  const workdays = input.estimatedWorkdays ?? 0;
  const workers = input.workersPerDay ?? 0;
  const hours = input.hoursPerDay ?? 0;
  if (workdays <= 0 || workers <= 0 || hours <= 0) return 0;
  return workdays * workers * hours;
}
