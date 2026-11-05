import { notFound } from "next/navigation";
import { Mail, MapPin, Phone, ReceiptText, User } from "lucide-react";
import { customerDetails, formatCurrency } from "@/lib/site-data";

export default function CustomerDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const customer = customerDetails.find((item) => item.id === id) ?? customerDetails[0];

  if (!customer) {
    notFound();
  }

  const tabs = [
    "Basic",
    "Docs",
    "Details",
    "Plant",
    "Expenses",
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Customer Profile</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">{customer.name}</h1>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
            {customer.paymentStatus}
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Contract Value" value={formatCurrency(customer.contractValue)} />
        <MetricCard label="Expenses" value={formatCurrency(customer.expenses)} />
        <MetricCard label="Received" value={formatCurrency(customer.received)} />
        <MetricCard label="Balance Due" value={formatCurrency(customer.balanceDue)} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-4 flex gap-2 overflow-x-auto">
          {tabs.map((tab, index) => (
            <button
              key={tab}
              className={[
                "rounded-xl px-3 py-2 text-sm font-medium",
                index === 0 ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600",
              ].join(" ")}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <InfoRow icon={User} label="Customer ID" value={customer.id} />
            <InfoRow icon={MapPin} label="Place" value={customer.place} />
            <InfoRow icon={Phone} label="Phone" value={customer.phone} />
            <InfoRow icon={Mail} label="Email" value={customer.email} />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center gap-2 text-slate-700">
              <ReceiptText className="h-4 w-4" />
              <span className="text-sm font-medium">Financial Snapshot</span>
            </div>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Contract Value</span>
                <strong className="text-slate-900">{formatCurrency(customer.contractValue)}</strong>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Profit / Loss</span>
                <strong className="text-emerald-700">{formatCurrency(customer.profitLoss)}</strong>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Notes</span>
                <span className="max-w-[170px] text-right text-slate-700">{customer.notes}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <div className="mt-3 text-xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-slate-600">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
        <p className="mt-1 text-sm font-medium text-slate-800">{value}</p>
      </div>
    </div>
  );
}
