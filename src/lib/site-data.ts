export type Kpi = {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
};

export type CustomerRow = {
  id: string;
  name: string;
  plant: string;
  totalPrice: number;
  received: number;
  balanceDue: number;
  paymentStatus: "Unpaid" | "Part-paid" | "Paid";
  capacity: number;
};

export type CustomerDetail = {
  id: string;
  name: string;
  serial: string;
  place: string;
  phone: string;
  email: string;
  consumerId: string;
  address: string;
  contractDate: string;
  contractValue: number;
  expenses: number;
  received: number;
  balanceDue: number;
  profitLoss: number;
  paymentStatus: "Unpaid" | "Part-paid" | "Paid";
  notes: string;
};

export const kpis: Kpi[] = [
  { label: "Total Clients", value: "1,482", change: "+8.2%", trend: "up" },
  { label: "Total Contract Value", value: "₹ 8.4 Cr", change: "+12.6%", trend: "up" },
  { label: "Total Payments Received", value: "₹ 6.8 Cr", change: "+9.1%", trend: "up" },
  { label: "Total Balance Due", value: "₹ 1.6 Cr", change: "-3.4%", trend: "down" },
  { label: "Total Actual Expenses", value: "₹ 2.1 Cr", change: "+5.7%", trend: "up" },
  { label: "Project Profit/Loss", value: "₹ 1.9 Cr", change: "+11.3%", trend: "up" },
  { label: "Cash Position", value: "₹ 4.7 Cr", change: "+7.5%", trend: "up" },
];

export const paymentStatusData = [
  { label: "Unpaid", value: 231, tone: "bg-slate-200" },
  { label: "Part-paid", value: 482, tone: "bg-amber-300" },
  { label: "Paid", value: 769, tone: "bg-emerald-500" },
];

export const recentPayments = [
  { name: "Aman Enterprises", amount: "₹ 1,42,000", date: "12 Mar 2026", status: "Confirmed" },
  { name: "Sree Venkatesa", amount: "₹ 84,500", date: "09 Mar 2026", status: "Pending" },
  { name: "Green Crest Homes", amount: "₹ 2,20,000", date: "06 Mar 2026", status: "Confirmed" },
  { name: "Blue Horizon", amount: "₹ 63,000", date: "02 Mar 2026", status: "Void" },
];

export const recentExpenses = [
  { name: "Vikram Solar", amount: "₹ 78,900", date: "11 Mar 2026", status: "Confirmed" },
  { name: "KSEB Charges", amount: "₹ 21,400", date: "10 Mar 2026", status: "Pending" },
  { name: "Panel Structure", amount: "₹ 34,700", date: "05 Mar 2026", status: "Confirmed" },
  { name: "Road Permit", amount: "₹ 16,300", date: "01 Mar 2026", status: "Void" },
];

export const customerRows: CustomerRow[] = [
  { id: "CUST-0001", name: "Aman Enterprises", plant: "5.0 kW", totalPrice: 450000, received: 320000, balanceDue: 130000, paymentStatus: "Part-paid", capacity: 5 },
  { id: "CUST-0002", name: "Sree Venkatesa", plant: "7.5 kW", totalPrice: 620000, received: 620000, balanceDue: 0, paymentStatus: "Paid", capacity: 7.5 },
  { id: "CUST-0003", name: "Green Crest Homes", plant: "10.0 kW", totalPrice: 890000, received: 540000, balanceDue: 350000, paymentStatus: "Part-paid", capacity: 10 },
  { id: "CUST-0004", name: "Blue Horizon", plant: "3.2 kW", totalPrice: 290000, received: 0, balanceDue: 290000, paymentStatus: "Unpaid", capacity: 3.2 },
  { id: "CUST-0005", name: "Sunrise Residency", plant: "8.4 kW", totalPrice: 710000, received: 710000, balanceDue: 0, paymentStatus: "Paid", capacity: 8.4 },
];

export const customerDetails: CustomerDetail[] = [
  {
    id: "CUST-0001",
    name: "Aman Enterprises",
    serial: "SOL-001",
    place: "Mysuru",
    phone: "+91 98765 43210",
    email: "aman@solar.in",
    consumerId: "KSEB-20481",
    address: "No. 18, Green Park Extension, Mysuru",
    contractDate: "2026-01-14",
    contractValue: 450000,
    expenses: 178000,
    received: 320000,
    balanceDue: 130000,
    profitLoss: 272000,
    paymentStatus: "Part-paid",
    notes: "Awaiting final inspection and net metering approval.",
  },
  {
    id: "CUST-0002",
    name: "Sree Venkatesa",
    serial: "SOL-002",
    place: "Bengaluru",
    phone: "+91 99876 12345",
    email: "venkatesa@gmail.com",
    consumerId: "KSEB-98314",
    address: "5th Cross, Kengeri, Bengaluru",
    contractDate: "2025-12-02",
    contractValue: 620000,
    expenses: 214000,
    received: 620000,
    balanceDue: 0,
    profitLoss: 406000,
    paymentStatus: "Paid",
    notes: "Customer paid in full; installation completed in January.",
  },
];

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}
