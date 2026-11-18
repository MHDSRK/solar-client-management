import type { ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F7F8FA] p-4 md:p-6">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5 lg:flex-row lg:gap-6">
        <Sidebar />
        <main className="min-w-0 flex-1 space-y-6">{children}</main>
      </div>
    </div>
  );
}
