import { describe, expect, it } from 'vitest';
import {
  CASE_BOARD_TABS,
  groupCasesIntoBoard,
  resolveCaseBoardPlacement,
} from './case-board';

describe('resolveCaseBoardPlacement', () => {
  it('places lifecycle statuses in the expected tab/column', () => {
    expect(resolveCaseBoardPlacement('LEAD')).toEqual({ tabKey: 'sale_planning', columnKey: 'lead' });
    expect(resolveCaseBoardPlacement('AWAITING_APPROVAL')).toEqual({
      tabKey: 'sale_planning',
      columnKey: 'awaiting_approval',
    });
    expect(resolveCaseBoardPlacement('IN_PROGRESS')).toEqual({ tabKey: 'execution', columnKey: 'in_progress' });
    expect(resolveCaseBoardPlacement('AWAITING_PAYMENT')).toEqual({
      tabKey: 'payment_closure',
      columnKey: 'awaiting_payment',
    });
    expect(resolveCaseBoardPlacement('PAID')).toEqual({ tabKey: 'payment_closure', columnKey: 'paid' });
  });

  it('maps legacy statuses onto board columns', () => {
    expect(resolveCaseBoardPlacement('DRAFT')?.columnKey).toBe('lead');
    expect(resolveCaseBoardPlacement('ACTIVE')?.columnKey).toBe('in_progress');
    expect(resolveCaseBoardPlacement('READY_FOR_REVIEW')?.columnKey).toBe('awaiting_billing');
    expect(resolveCaseBoardPlacement('COMPLETED')?.columnKey).toBe('awaiting_billing');
  });

  it('does not place cancelled projects on the board', () => {
    expect(resolveCaseBoardPlacement('CANCELLED')).toBeUndefined();
  });
});

describe('CASE_BOARD_TABS', () => {
  it('has the three spec tabs with unique column keys', () => {
    expect(CASE_BOARD_TABS.map((t) => t.key)).toEqual(['sale_planning', 'execution', 'payment_closure']);
    const columnKeys = CASE_BOARD_TABS.flatMap((t) => t.columns.map((c) => c.key));
    expect(new Set(columnKeys).size).toBe(columnKeys.length);
  });
});

describe('groupCasesIntoBoard', () => {
  it('groups cases into their columns and collects cancelled as unplaced', () => {
    const cases = [
      { id: '1', status: 'LEAD' as const },
      { id: '2', status: 'IN_PROGRESS' as const },
      { id: '3', status: 'ACTIVE' as const },
      { id: '4', status: 'PAID' as const },
      { id: '5', status: 'CANCELLED' as const },
    ];

    const board = groupCasesIntoBoard(cases);

    const findColumn = (columnKey: string) =>
      board.tabs.flatMap((t) => t.columns).find((c) => c.key === columnKey);

    expect(findColumn('lead')?.items.map((i) => i.id)).toEqual(['1']);
    expect(findColumn('in_progress')?.items.map((i) => i.id)).toEqual(['2', '3']);
    expect(findColumn('paid')?.items.map((i) => i.id)).toEqual(['4']);
    expect(board.unplaced.map((i) => i.id)).toEqual(['5']);
  });

  it('returns empty columns for an empty input', () => {
    const board = groupCasesIntoBoard([]);
    const totalItems = board.tabs.flatMap((t) => t.columns).reduce((sum, c) => sum + c.items.length, 0);
    expect(totalItems).toBe(0);
    expect(board.unplaced).toEqual([]);
  });
});
