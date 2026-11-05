import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { customerRows, formatCurrency } from "@/lib/site-data";

export default function CustomersPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Portfolio</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Customer Records</h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            <Search className="h-4 w-4" />
            <input
              className="w-44 border-0 bg-transparent text-sm outline-none placeholder:text-slate-400"
              placeholder="Search customers"
              aria-label="Search customers"
            />
          </div>
          <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            + Add Customer
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 font-medium">Sl No.</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Plant</th>
                <th className="px-4 py-3 font-medium">Total Price</th>
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Balance Due</th>
                <th className="px-4 py-3 font-medium">Payment Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customerRows.map((row, index) => (
                <tr key={row.id} className="border-t border-slate-200">
                  <td className="px-4 py-3 text-slate-500">{index + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <Link href={`/customers/${row.id}`} className="font-medium text-slate-900 hover:text-sky-700">
                        {row.name}
                      </Link>
                      <span className="text-xs text-slate-500">{row.id}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.plant}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCurrency(row.totalPrice)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCurrency(row.received)}</td>
                  <td className="px-4 py-3 text-slate-700">{formatCurrency(row.balanceDue)}</td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        "rounded-full px-2.5 py-1 text-[11px] font-medium",
                        row.paymentStatus === "Paid" && "bg-emerald-100 text-emerald-700",
                        row.paymentStatus === "Part-paid" && "bg-amber-100 text-amber-700",
                        row.paymentStatus === "Unpaid" && "bg-slate-200 text-slate-700",
                      ].join(" ")}
                    >
                      {row.paymentStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/customers/${row.id}`}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50"
                    >
                      View
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
