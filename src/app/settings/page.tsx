import { AppShell } from "@/components/app-shell";

const settingsCards = [
  {
    title: "Admin access",
    description: "Sign-in is limited to the approved administrator email allowlist. No manager or staff roles are enabled.",
    status: "Code present",
  },
  {
    title: "Customer database",
    description: "Customer reads and writes are not implemented in this code-only version.",
    status: "Unavailable",
  },
  {
    title: "Google Drive",
    description: "Drive folder linking, uploads, and document management are not implemented.",
    status: "Unavailable",
  },
  {
    title: "Google Sheets",
    description: "Sheet synchronization, retry handling, and sync status are not implemented.",
    status: "Unavailable",
  },
  {
    title: "Rate & pricing",
    description: "Rate master records and pricing workflows are not connected to stored data.",
    status: "Unavailable",
  },
];

export default function SettingsPage() {
  return (
    <AppShell>
      <header className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Administration</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">System Settings</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          This code-only version shows implementation status without exposing setup controls that do not work yet.
        </p>
      </header>

      <section aria-label="Feature implementation status" className="grid gap-4 md:grid-cols-2">
        {settingsCards.map((card) => (
          <article key={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
              </div>
              <span
                className={[
                  "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                  card.status === "Code present" ? "bg-slate-100 text-slate-700" : "bg-amber-100 text-amber-800",
                ].join(" ")}
              >
                {card.status}
              </span>
            </div>
          </article>
        ))}
      </section>
    </AppShell>
  );
}
