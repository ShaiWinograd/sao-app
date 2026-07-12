export type DashboardIssueSeverity = 'high' | 'medium' | 'low';

export type DashboardIssue = {
  id: string;
  projectName: string;
  issue: string;
  href: string;
  dateLabel?: string;
  severity: DashboardIssueSeverity;
};

export type DashboardWorkflowSection = {
  key: string;
  title: string;
  items: DashboardIssue[];
};

const DASHBOARD_SECTION_ORDER = [
  'quote-awaiting-approval',
  'approved-awaiting-scheduling',
  'partial-scheduling',
  'jobs-understaffed',
  'jobs-missing-manager',
  'customer-forms-pending',
  'attendance-exceptions',
  'awaiting-billing',
  'awaiting-payment',
];

const SEVERITY_WEIGHT: Record<DashboardIssueSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export function orderDashboardWorkflowSections(
  sections: DashboardWorkflowSection[],
): DashboardWorkflowSection[] {
  const indexByKey = new Map(DASHBOARD_SECTION_ORDER.map((key, index) => [key, index]));
  return [...sections].sort((a, b) => {
    const aIndex = indexByKey.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = indexByKey.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.title.localeCompare(b.title, 'he');
  });
}

export function extractUrgentDashboardIssues(
  sections: DashboardWorkflowSection[],
  maxItems = 8,
): DashboardIssue[] {
  const flattened = sections.flatMap((section) => section.items);
  const urgent = flattened
    .filter((item) => item.severity === 'high' || item.severity === 'medium')
    .sort((a, b) => {
      const severityDiff = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return a.projectName.localeCompare(b.projectName, 'he');
    });

  return urgent.slice(0, maxItems);
}
