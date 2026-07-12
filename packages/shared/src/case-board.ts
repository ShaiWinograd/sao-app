import type { CaseStatusValue } from './case-lifecycle';

// Projects kanban board structure (business_app_ux_spec/03-projects.md).
// Three tabs — sale/planning, execution, payment/closure — each split into
// lifecycle columns. Legacy statuses are mapped to the closest column so
// existing projects still appear on the board.

export type CaseBoardTabKey = 'sale_planning' | 'execution' | 'payment_closure';

export type CaseBoardColumn = {
  key: string;
  title: string;
  statuses: CaseStatusValue[];
};

export type CaseBoardTab = {
  key: CaseBoardTabKey;
  title: string;
  columns: CaseBoardColumn[];
};

export const CASE_BOARD_TABS: CaseBoardTab[] = [
  {
    key: 'sale_planning',
    title: 'מכירה ותכנון',
    columns: [
      { key: 'lead', title: 'ליד חדש', statuses: ['LEAD', 'DRAFT'] },
      { key: 'quotation_draft', title: 'בהכנת הצעת מחיר', statuses: ['QUOTATION_DRAFT'] },
      { key: 'awaiting_approval', title: 'מחכה לאישור', statuses: ['AWAITING_APPROVAL'] },
      { key: 'reserved', title: 'משוריין', statuses: ['RESERVED'] },
    ],
  },
  {
    key: 'execution',
    title: 'ביצוע',
    columns: [
      { key: 'approved_no_dates', title: 'מאושר – ללא תאריכים', statuses: ['APPROVED_NO_DATES'] },
      { key: 'partial_scheduling', title: 'תזמון חלקי', statuses: ['PARTIALLY_SCHEDULED'] },
      { key: 'ready', title: 'מאושר לביצוע', statuses: ['READY_FOR_EXECUTION'] },
      { key: 'in_progress', title: 'בביצוע', statuses: ['IN_PROGRESS', 'ACTIVE'] },
      { key: 'awaiting_completion', title: 'מחכה להשלמות', statuses: ['AWAITING_COMPLETION'] },
    ],
  },
  {
    key: 'payment_closure',
    title: 'תשלום וסגירה',
    columns: [
      {
        key: 'awaiting_billing',
        title: 'מחכה לחיוב',
        statuses: ['AWAITING_BILLING', 'READY_FOR_REVIEW', 'COMPLETED'],
      },
      { key: 'awaiting_payment', title: 'מחכה לתשלום', statuses: ['AWAITING_PAYMENT'] },
      { key: 'paid', title: 'שולם', statuses: ['PAID'] },
    ],
  },
];

export type CaseBoardPlacement = {
  tabKey: CaseBoardTabKey;
  columnKey: string;
};

const PLACEMENT_BY_STATUS: Map<CaseStatusValue, CaseBoardPlacement> = (() => {
  const map = new Map<CaseStatusValue, CaseBoardPlacement>();
  for (const tab of CASE_BOARD_TABS) {
    for (const column of tab.columns) {
      for (const status of column.statuses) {
        map.set(status, { tabKey: tab.key, columnKey: column.key });
      }
    }
  }
  return map;
})();

// Returns the board tab + column for a status, or undefined for statuses that
// are not shown on the board (e.g. CANCELLED, which is archived).
export function resolveCaseBoardPlacement(status: CaseStatusValue): CaseBoardPlacement | undefined {
  return PLACEMENT_BY_STATUS.get(status);
}

export type CaseBoardColumnResult<T> = {
  key: string;
  title: string;
  items: T[];
};

export type CaseBoardTabResult<T> = {
  key: CaseBoardTabKey;
  title: string;
  columns: CaseBoardColumnResult<T>[];
};

export type CaseBoardResult<T> = {
  tabs: CaseBoardTabResult<T>[];
  unplaced: T[];
};

// Groups projects into the board structure. Items whose status has no board
// column (e.g. CANCELLED) are returned in `unplaced`.
export function groupCasesIntoBoard<T extends { status: CaseStatusValue }>(
  cases: T[],
): CaseBoardResult<T> {
  const tabs: CaseBoardTabResult<T>[] = CASE_BOARD_TABS.map((tab) => ({
    key: tab.key,
    title: tab.title,
    columns: tab.columns.map((column) => ({ key: column.key, title: column.title, items: [] as T[] })),
  }));

  const columnIndex = new Map<string, CaseBoardColumnResult<T>>();
  for (const tab of tabs) {
    for (const column of tab.columns) {
      columnIndex.set(column.key, column);
    }
  }

  const unplaced: T[] = [];
  for (const item of cases) {
    const placement = resolveCaseBoardPlacement(item.status);
    const column = placement ? columnIndex.get(placement.columnKey) : undefined;
    if (column) {
      column.items.push(item);
    } else {
      unplaced.push(item);
    }
  }

  return { tabs, unplaced };
}
