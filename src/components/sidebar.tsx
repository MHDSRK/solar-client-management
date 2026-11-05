import Link from "next/link";
import {
  BarChart3,
  Building2,
  CreditCard,
  FolderCog,
  LayoutDashboard,
  Settings,
  SunMedium,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="flex w-full max-w-[280px] flex-col border-r border-slate-200 bg-white/90 p-5 backdrop-blur">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-amber-300">
          <SunMedium className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Solar</p>
          <h1 className="text-lg font-semibold text-slate-900">Client System</h1>
        </div>
      </div>

      <nav className="space-y-2">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          <FolderCog className="h-3.5 w-3.5" />
          Operational
        </div>
        <div className="space-y-2 text-sm text-slate-600">
          <div className="flex items-center justify-between">
            <span>Drive</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Live</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Sheets</span>
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">Queued</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Payments</span>
            <span className="flex items-center gap-1 text-emerald-600">
              <CreditCard className="h-3.5 w-3.5" />
              98.4%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Analytics</span>
            <span className="flex items-center gap-1 text-sky-600">
              <BarChart3 className="h-3.5 w-3.5" />
              24h
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
