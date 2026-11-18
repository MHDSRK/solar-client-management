import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";

export default function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-slate-500">Loading customer profile…</p>}>
      <CustomerDetailContent params={params} />
    </Suspense>
  );
}

async function CustomerDetailContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <AppShell>
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Customer profile</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">Live profile unavailable</h1>
        <p className="mt-2 text-sm text-slate-600">Requested record: {id}</p>
      </header>

      <section
        aria-labelledby="profile-unavailable-heading"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        role="status"
      >
        <h2 id="profile-unavailable-heading" className="text-lg font-semibold text-slate-900">
          This page is not connected to live customer data
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          No sample contact details, balances, or project values are shown. Customer profile reads remain unavailable in
          this code-only version.
        </p>
        <Link
          href="/customers"
          className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Back to customers
        </Link>
      </section>
    </AppShell>
  );
}
