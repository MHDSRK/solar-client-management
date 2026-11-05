export type PaymentStatus = "Unpaid" | "Part-paid" | "Paid";

export function getPaymentStatus(received: number, contractValue: number): PaymentStatus {
  if (received === 0) return "Unpaid";
  if (received > 0 && received < contractValue) return "Part-paid";
  return "Paid";
}

export function computeBalanceDue(contractValue: number, received: number): number {
  return contractValue - received;
}

export function computeProjectProfit(contractValue: number, actualExpenses: number): number {
  return contractValue - actualExpenses;
}

export function computeCashPosition(received: number, actualExpenses: number): number {
  return received - actualExpenses;
}

export function computeDisunCost(capacityKw: number, disunRatePerKw: number): number {
  return capacityKw * disunRatePerKw;
}

export function computeExpenseTotal(expense: {
  disunCost?: number;
  kseb?: number;
  meterCost?: number;
  structure?: number;
  material?: number;
  electrical?: number;
  paperwork?: number;
}) {
  return [
    expense.disunCost ?? 0,
    expense.kseb ?? 0,
    expense.meterCost ?? 0,
    expense.structure ?? 0,
    expense.material ?? 0,
    expense.electrical ?? 0,
    expense.paperwork ?? 0,
  ].reduce((sum, value) => sum + value, 0);
}
