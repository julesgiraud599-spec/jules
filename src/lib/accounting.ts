import { saleNet } from "./scoring";
import { dayKey } from "./format";

export type SaleRow = { date: Date; salePrice: number; purchaseCost: number; shippingCost: number; fees: number; packaging: number; refunded: boolean; refundAmount: number; quantity: number };
export type ExpenseRow = { date: Date; amount: number; category: string };

/**
 * Bénéfice net = revenus (ventes − remboursements) − coûts des ventes − cotisations − dépenses hors stock.
 * Les dépenses « STOCK » ne sont pas re-déduites : le coût d'achat est déjà compté dans chaque vente (évite le double comptage).
 */
export function summarize(sales: SaleRow[], expenses: ExpenseRow[], rate: number) {
  let revenue = 0, costs = 0, contributions = 0, refunds = 0, count = 0, marginSum = 0, marginN = 0;
  for (const s of sales) {
    const n = saleNet(s, rate);
    revenue += n.revenue; costs += n.costs; contributions += n.contributions;
    if (s.refunded) refunds += s.refundAmount; else count += s.quantity;
    if (n.revenue > 0) { marginSum += (n.net / n.revenue) * 100; marginN++; }
  }
  const opex = expenses.filter((e) => e.category !== "STOCK").reduce((a, e) => a + e.amount, 0);
  const allExpenses = expenses.reduce((a, e) => a + e.amount, 0);
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    revenue: r(revenue), costs: r(costs), contributions: r(contributions), refunds: r(refunds), salesCount: count,
    operatingExpenses: r(opex), expensesTotal: r(allExpenses),
    netProfit: r(revenue - costs - contributions - opex),
    avgMarginPct: marginN ? r(marginSum / marginN) : null,
  };
}

export function bucket<T extends { date: Date }>(rows: T[], key: (d: Date) => string, labels: string[], value: (rows: T[]) => number) {
  const map = new Map<string, T[]>();
  for (const row of rows) { const k = key(row.date); map.set(k, [...(map.get(k) ?? []), row]); }
  return labels.map((k) => ({ key: k, value: Math.round(value(map.get(k) ?? []) * 100) / 100 }));
}
export const monthKey = (d: Date) => dayKey(d).slice(0, 7);
export function lastDays(n: number) { return Array.from({ length: n }, (_, i) => dayKey(new Date(Date.now() - (n - 1 - i) * 86_400_000))); }
export function lastMonths(n: number) {
  const now = new Date(); return Array.from({ length: n }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 15); return monthKey(d); });
}
