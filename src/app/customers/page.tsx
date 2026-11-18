import { Database } from "lucide-react";
import { AppShell } from "@/components/app-shell";

export default function CustomersPage() {
  return (
    <AppShell>
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Portfolio</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Customer Records</h1>
      </header>

      <section
        aria-labelledby="customers-empty-heading"
        className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
        role="status"
      >
        <div className="flex size-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
          <Database aria-hidden="true" className="size-5" />
        </div>
        <h2 id="customers-empty-heading" className="mt-4 text-lg font-semibold text-slate-900">
          Live customer records are unavailable
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Customer search, creation, and financial records are not connected in this code-only version. No placeholder
          customers are shown.
        </p>
      </section>
    </AppShell>
  );
}
