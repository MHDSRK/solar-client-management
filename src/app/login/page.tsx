"use client";

import { Eye, EyeOff, LockKeyhole, Mail, SunMedium } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { signInAction } from "@/app/actions/auth";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginLoadingState />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginLoadingState() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F8FA] p-6">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_22px_80px_rgba(15,23,42,0.08)]">
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500">Loading</p>
        <h2 className="mt-3 text-2xl font-semibold text-slate-900">Preparing sign in</h2>
      </div>
    </main>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const queryError = useMemo(() => {
    const errorType = params.get("error");
    if (errorType === "unauthorized-email") {
      return "This account is not authorized for the Solar Client Management portal.";
    }
    if (errorType === "auth-unavailable") {
      return "Authentication is not configured. Please contact the system administrator.";
    }
    return null;
  }, [params]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const response = await signInAction(formData);

    if (response?.error) {
      setError(response.error);
      setPending(false);
      return;
    }

    setPending(false);
  }

  const displayError = queryError ?? error;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F7F8FA] p-6">
      <div className="w-full max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_22px_80px_rgba(15,23,42,0.08)]">
        <div className="grid min-h-[720px] lg:grid-cols-[1.1fr_0.9fr]">
          <section className="flex flex-col justify-between bg-[#172B4D] p-8 text-white lg:p-12">
            <div>
              <div className="mb-8 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#D9B283] text-slate-900">
                  <SunMedium className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-200">Solar</p>
                  <p className="text-lg font-semibold">Client Management</p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-300">Operations</p>
                <h1 className="max-w-md text-4xl font-semibold leading-tight tracking-tight">
                  Secure solar operations, financial clarity, and customer accountability.
                </h1>
              </div>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <StatCard label="Clients" value="1,482" />
              <StatCard label="Revenue" value="₹8.4Cr" />
              <StatCard label="Sync" value="99.4%" />
            </div>
          </section>

          <section className="flex items-center justify-center bg-white p-6 lg:p-10">
            <div className="w-full max-w-md">
              <div className="mb-8 text-center">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Welcome back</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-900">Sign in</h2>
              </div>

              <form className="space-y-5" onSubmit={onSubmit}>
                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                    <Mail className="h-4 w-4" />
                    Email
                  </span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                    placeholder="name@company.com"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-700">
                    <LockKeyhole className="h-4 w-4" />
                    Password
                  </span>
                  <div className="relative">
                    <input
                      name="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 pr-11 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:bg-white"
                      placeholder="Enter your password"
                      required
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-3 flex items-center text-slate-500"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>

                <div className="flex items-center justify-between gap-3 text-sm">
                  <label className="flex items-center gap-2 text-slate-600">
                    <input name="remember" type="checkbox" className="h-4 w-4 rounded border-slate-300 text-slate-900" />
                    Remember me
                  </label>
                  <a href="/login" className="font-medium text-slate-700 underline-offset-2 hover:underline">
                    Forgot password?
                  </a>
                </div>

                {displayError ? (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {displayError}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={pending}
                  className="flex w-full items-center justify-center rounded-xl bg-[#172B4D] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#243b62] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {pending ? "Signing in..." : "Sign in"}
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-300">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
    </div>
  );
}
