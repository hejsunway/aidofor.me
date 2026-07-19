// filepath: proxy.ts
// Next.js 16 "proxy" (formerly middleware). Runs before matched routes to:
//   1. Refresh the Supabase auth session cookies (the supabaseResponse dance).
//   2. Gate the /app workspace so unauthenticated requests redirect to /login.
//   3. Redirect already-logged-in users away from /login and /signup.
//   4. Redirect logged-in users who hit /auth/callback?type=recovery to
//      /reset-password so the PKCE recovery flow finishes inside AidoForMe.
//
// TutorPakar already runs an identical pattern in src/proxy.ts; AidoForMe
// keeps its own proxy because the protected surface and domain are
// different.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function isSafeNextPath(value: string | null | undefined): boolean {
  if (!value) return false;
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !/^[a-z][a-z0-9+.-]*:/i.test(value)
  );
}

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Without env vars we cannot validate auth. Fail closed for protected
    // routes, allow marketing routes through.
    const { pathname } = request.nextUrl;
    if (pathname.startsWith("/app")) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() is authoritative (network round-trip) and refreshes the
  // session. The proxy runs once per matched request, so the cost is
  // acceptable.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, searchParams } = request.nextUrl;
  const nextParam = searchParams.get("next");
  const safeNext = isSafeNextPath(nextParam) ? (nextParam as string) : "/app";

  // /auth/callback: bounce signed-in users to next; bounce recovery
  // verification to the reset screen. Supabase emails include either a
  // PKCE ?code= or a hash-fragment token; both are handled by the
  // /auth/callback route. Here we only guard routing.
  if (pathname === "/auth/callback" && user) {
    const url = request.nextUrl.clone();
    url.pathname = safeNext === "/reset-password" ? "/reset-password" : safeNext;
    url.search = "";
    return NextResponse.redirect(url);
  }

  // /reset-password: this screen MUST be reached only with a verified
  // session from the recovery link. If the user has no session, send them
  // through the forgot-password flow.
  if (pathname === "/reset-password" && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/forgot-password";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Protect the /app workspace.
  if (!user && pathname.startsWith("/app")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Already logged in? Send them away from the auth screens.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Protect the workspace.
    "/app/:path*",
    // Run on the auth surfaces so we can redirect signed-in users and
    // bounce unverified users away from /reset-password.
    "/login",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
  ],
};