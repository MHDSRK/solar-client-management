import { ArrowDownRight, ArrowUpRight } from "lucide-react";

export function KpiCard({
  label,
  value,
  change,
  trend,
}: {
  label: string;
  value: string;
  change: string;
  trend: "up" | "down" | "neutral";
}) {
  const isUp = trend === "up";
  const isDown = trend === "down";

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-slate-500">{label}</p>
        <span
          className={[
            "flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium",
            isUp && "bg-emerald-100 text-emerald-700",
            isDown && "bg-rose-100 text-rose-700",
            !isUp && !isDown && "bg-slate-100 text-slate-600",
          ].join(" ")}
        >
          {isUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : null}
          {isDown ? <ArrowDownRight className="h-3.5 w-3.5" /> : null}
          {change}
        </span>
      </div>
      <div className="text-3xl font-semibold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
