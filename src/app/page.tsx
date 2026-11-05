import { Bell, Download, Plus, TrendingUp } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { Sidebar } from "@/components/sidebar";
import { kpis, paymentStatusData, recentExpenses, recentPayments } from "@/lib/site-data";

const bars = [52, 68, 48, 90, 76, 88, 63, 96];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F7F8FA] p-4 md:p-6">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-6 xl:flex-row">
        <Sidebar />

        <main className="flex-1 space-y-6">
          <header className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Overview</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">Solar business dashboard</h1>
            </div>
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                <Download className="h-4 w-4" />
                Export
              </button>
              <button className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white">
                <Plus className="h-4 w-4" />
                Add Customer
              </button>
              <button className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700">
                <Bell className="h-4 w-4" />
              </button>
            </div>
          </header>

          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kpis.slice(0, 4).map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[1.5fr_0.9fr]">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Performance</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">Revenue vs Expenses</h2>
                </div>
                <div className="flex items-center gap-2 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  <TrendingUp className="h-3.5 w-3.5" />
                  +8.4% QoQ
                </div>
              </div>

              <div className="flex h-52 items-end gap-3">
                <div className="flex flex-1 items-end gap-3">
                  {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"].map((month, index) => (
                    <div key={month} className="flex flex-1 flex-col items-center gap-2">
                      <div className="flex h-40 w-full items-end gap-1">
                        <div className="w-1/2 rounded-t-xl bg-slate-900" style={{ height: `${bars[index]}%` }} />
                        <div className="w-1/2 rounded-t-xl bg-amber-300" style={{ height: `${Math.max(35, bars[index] - 18)}%` }} />
                      </div>
                      <span className="text-[11px] font-medium text-slate-500">{month}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Payment status</p>
              <h2 className="mt-2 text-xl font-semibold text-slate-900">Customer mix</h2>
              <div className="mt-6 space-y-4">
                {paymentStatusData.map((item) => (
                  <div key={item.label}>
                    <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
                      <span>{item.label}</span>
                      <span className="font-medium text-slate-900">{item.value}</span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-100">
                      <div
                        className={`h-2.5 rounded-full ${item.tone}`}
                        style={{ width: `${(item.value / 769) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {kpis.slice(4).map((kpi) => (
              <KpiCard key={kpi.label} {...kpi} />
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-900">Recent payments</h2>
                <span className="text-sm text-slate-500">Last 7 days</span>
              </div>
              <div className="space-y-3">
                {recentPayments.map((payment) => (
                  <div key={payment.name} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <div className="font-medium text-slate-900">{payment.name}</div>
                      <div className="text-xs text-slate-500">{payment.date}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-slate-900">{payment.amount}</div>
                      <div className="text-xs text-emerald-700">{payment.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-900">Recent expenses</h2>
                <span className="text-sm text-slate-500">Last 7 days</span>
              </div>
              <div className="space-y-3">
                {recentExpenses.map((expense) => (
                  <div key={expense.name} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div>
                      <div className="font-medium text-slate-900">{expense.name}</div>
                      <div className="text-xs text-slate-500">{expense.date}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-slate-900">{expense.amount}</div>
                      <div className="text-xs text-amber-700">{expense.status}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
