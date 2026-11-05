import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAuthorizedEmail } from "@/lib/authorized-users";

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });
  const pathname = request.nextUrl.pathname;
  const isPublicRoute = pathname === "/login";

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    if (process.env.NODE_ENV === "production" && !isPublicRoute) {
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("error", "auth-unavailable");
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set({ name, value, ...options });
            response.cookies.set({ name, value, ...options });
          });
        },
      },
    },
  );

  const { data } = await supabase.auth.getUser();

  if (!data.user && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (data.user) {
    if (!isAuthorizedEmail(data.user.email)) {
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set("error", "unauthorized-email");
      return NextResponse.redirect(redirectUrl);
    }

    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/customers", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
