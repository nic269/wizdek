import { NextResponse } from "next/server";

type AuthGuardRequest = Request & {
  nextUrl?: URL;
  cookies?: {
    get: (name: string) => unknown;
  };
};

const sessionCookieNames = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
] as const;

const hasSessionCookie = (request: AuthGuardRequest) =>
  sessionCookieNames.some((name) => {
    if (request.cookies?.get(name)) {
      return true;
    }

    const cookieHeader = request.headers.get("cookie") ?? "";
    return cookieHeader
      .split(";")
      .some((cookie) => cookie.trim().startsWith(`${name}=`));
  });

export const createAuthGuard =
  (paths: { signIn: string; dashboard: string }) =>
  (request: AuthGuardRequest) => {
    const url = request.nextUrl ?? new URL(request.url);
    const isProtected = url.pathname.startsWith(paths.dashboard);

    if (isProtected && !hasSessionCookie(request)) {
      return NextResponse.redirect(new URL(paths.signIn, request.url));
    }

    return NextResponse.next();
  };
