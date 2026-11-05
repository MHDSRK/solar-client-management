const settingsCards = [
  {
    title: "Google Drive",
    description: "Connect Google account, review permissions, and manage folder configuration.",
    status: "Connected",
  },
  {
    title: "Google Sheets",
    description: "Check workbook setup, queue health, and retry failed synchronization tasks.",
    status: "Queued",
  },
  {
    title: "Rate Management",
    description: "Maintain panel brands, wattages, effective dates, and disun rates.",
    status: "Active",
  },
  {
    title: "User Management",
    description: "Create users, adjust permissions, and manage role-based access controls.",
    status: "Secure",
  },
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Administration</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">System Settings</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {settingsCards.map((card) => (
          <div key={card.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{card.description}</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                {card.status}
              </span>
            </div>
            <button className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
              Configure
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
