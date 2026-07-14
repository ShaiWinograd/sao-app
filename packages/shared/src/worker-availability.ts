// Worker availability finder — pure ranking logic for the scheduling flow.
// Availability is derived from a worker's already-booked dates (existing shifts);
// there is no separate availability calendar. Given a job's requirements, this
// ranks candidate workers so the scheduler can pick the best fit first.

export const MANAGER_SKILL = 'SHIFT_LEADER';

export type WorkerCandidate = {
  id: string;
  name: string;
  skills: string[];
  isActive: boolean;
  homeArea?: string | null;
  bookedDates: string[];
};

export type AvailabilityQuery = {
  date: string;
  requiredSkill?: string | null;
  requiresManager?: boolean;
  area?: string | null;
};

export type RankedCandidate = {
  id: string;
  name: string;
  available: boolean;
  hasRequiredSkill: boolean;
  isManagerCapable: boolean;
  score: number;
  reasons: string[];
};

const SCORE_AVAILABLE = 100;
const SCORE_SKILL_MATCH = 50;
const SCORE_MANAGER_NEEDED = 30;
const SCORE_MANAGER_BONUS = 5;
const SCORE_AREA_MATCH = 10;

// Ranks active candidates best-fit first. Inactive workers are excluded.
export function rankWorkerAvailability(
  query: AvailabilityQuery,
  candidates: WorkerCandidate[],
): RankedCandidate[] {
  const ranked = candidates
    .filter((candidate) => candidate.isActive)
    .map((candidate) => {
      const available = !candidate.bookedDates.includes(query.date);
      const hasRequiredSkill = !query.requiredSkill || candidate.skills.includes(query.requiredSkill);
      const isManagerCapable = candidate.skills.includes(MANAGER_SKILL);
      const reasons: string[] = [];

      let score = 0;
      if (available) {
        score += SCORE_AVAILABLE;
        reasons.push('זמין בתאריך');
      } else {
        reasons.push('עמוס בתאריך');
      }

      if (query.requiredSkill && hasRequiredSkill) {
        score += SCORE_SKILL_MATCH;
        reasons.push('כישור מתאים');
      }

      if (query.requiresManager) {
        if (isManagerCapable) {
          score += SCORE_MANAGER_NEEDED;
          reasons.push('יכול לשמש מנהל עבודה');
        }
      } else if (isManagerCapable) {
        score += SCORE_MANAGER_BONUS;
      }

      if (query.area && candidate.homeArea && candidate.homeArea === query.area) {
        score += SCORE_AREA_MATCH;
        reasons.push('אזור מגורים תואם');
      }

      return {
        id: candidate.id,
        name: candidate.name,
        available,
        hasRequiredSkill,
        isManagerCapable,
        score,
        reasons,
      };
    });

  return ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name, 'he');
  });
}
