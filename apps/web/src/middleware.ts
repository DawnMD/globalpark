import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Cookie-presence check only -- no DB round trip, matching Better
 * Auth's documented middleware pattern. This is coarse gating (route
 * away signed-out visitors); the actual authorization decision
 * (does this session's user belong to this facility's operator, D12)
 * happens per-request in the oRPC procedures and the dashboard's
 * Server Components, which do hit the database.
 */
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
