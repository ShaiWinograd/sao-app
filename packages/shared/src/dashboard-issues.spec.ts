import { describe, expect, it } from 'vitest';
import {
  extractUrgentDashboardIssues,
  orderDashboardWorkflowSections,
  type DashboardWorkflowSection,
} from './dashboard-issues';

function section(
  key: string,
  title: string,
  items: Array<{ id: string; severity: 'high' | 'medium' | 'low' }>,
): DashboardWorkflowSection {
  return {
    key,
    title,
    items: items.map((item) => ({
      id: item.id,
      projectName: `Project ${item.id}`,
      issue: `Issue ${item.id}`,
      href: '/dashboard',
      severity: item.severity,
    })),
  };
}

describe('orderDashboardWorkflowSections', () => {
  it('orders dashboard sections by canonical workflow order', () => {
    const ordered = orderDashboardWorkflowSections([
      section('awaiting-payment', 'מחכה לתשלום מהלקוח', []),
      section('jobs-understaffed', 'עבודות לא מאוישות', []),
      section('quote-awaiting-approval', 'מחכה לאישור הצעת מחיר', []),
    ]);

    expect(ordered.map((item) => item.key)).toEqual([
      'quote-awaiting-approval',
      'jobs-understaffed',
      'awaiting-payment',
    ]);
  });
});

describe('extractUrgentDashboardIssues', () => {
  it('returns high/medium issues first and limits by maxItems', () => {
    const urgent = extractUrgentDashboardIssues(
      [
        section('jobs-understaffed', 'עבודות לא מאוישות', [
          { id: 'a', severity: 'medium' },
          { id: 'b', severity: 'high' },
        ]),
        section('awaiting-payment', 'מחכה לתשלום', [
          { id: 'c', severity: 'low' },
          { id: 'd', severity: 'medium' },
        ]),
      ],
      2,
    );

    expect(urgent).toHaveLength(2);
    expect(urgent[0]?.severity).toBe('high');
    expect(urgent[1]?.severity).toBe('medium');
    expect(urgent.map((item) => item.id)).toContain('b');
  });
});
