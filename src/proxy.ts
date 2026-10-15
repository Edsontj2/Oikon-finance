import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const publicPaths = ["/login", "/cadastro"];

export async function proxy(request: NextRequest) {
  const loggedIn = (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) !== null;
  const isPublic = publicPaths.includes(request.nextUrl.pathname);

  if (!loggedIn && !isPublic) return NextResponse.redirect(new URL("/login", request.url));
  if (loggedIn && isPublic) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|icon.svg).*)"],
};
