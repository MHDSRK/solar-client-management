import Link from "next/link";
import { Building2, LayoutDashboard, Settings, SunMedium } from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "Customers", icon: Building2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="flex w-full flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6 lg:h-[calc(100dvh-3rem)] lg:max-w-[280px] lg:flex-shrink-0 lg:rounded-2xl lg:p-5">
      <div className="flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-xl bg-slate-900 text-amber-300">
          <SunMedium aria-hidden="true" className="size-5" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-slate-500">Solar</p>
          <p className="text-lg font-semibold text-slate-900">Client System</p>
        </div>
      </div>

      <nav aria-label="Main navigation" className="grid grid-cols-3 gap-1 lg:flex lg:flex-col lg:gap-2">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-xl px-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 sm:gap-2 sm:px-3 sm:text-sm lg:justify-start"
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        ))}
      </nav>

      <div className="mt-auto rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-5 text-slate-600">
        <p className="font-medium text-slate-800">Business data unavailable</p>
        <p className="mt-1">No sample records or operational status are displayed.</p>
      </div>
    </aside>
  );
}
