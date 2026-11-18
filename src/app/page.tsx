import { AppShell } from "@/components/app-shell";

export default function Home() {
  return (
    <AppShell>
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Overview</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
          Solar business dashboard
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Live business metrics will appear here when database reads are implemented.
        </p>
      </header>

      <section
        aria-labelledby="dashboard-data-heading"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        role="status"
      >
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-500">Live data unavailable</p>
        <h2 id="dashboard-data-heading" className="mt-2 text-lg font-semibold text-slate-900">
          No financial totals or customer activity are being displayed
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          This code-only version does not read operational records. Sample balances, charts, and payment activity
          have been removed so they cannot be mistaken for business data.
        </p>
      </section>
    </AppShell>
  );
}
