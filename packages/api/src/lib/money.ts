/** Simple fixed-point arithmetic helper (avoids floating point drift for money) */
type MoneyLike = number | string | { toString(): string } | null | undefined;

export function money(n: MoneyLike): number {
  return parseFloat((parseFloat(String(n ?? 0)) || 0).toFixed(4));
}

export function round2(n: number): string {
  return n.toFixed(2);
}
