import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";

const publicPaths = ["/login", "/cadastro"];

/**
 * Primeira barreira, barata: sem cookie válido, só as telas públicas abrem.
 * Quem está logado e abre /login é redirecionado pela própria página, depois de
 * conferir no banco que a sessão ainda existe (um cookie de sessão encerrada não vale).
 */
export async function proxy(request: NextRequest) {
  const isPublic = publicPaths.includes(request.nextUrl.pathname);
  if (!isPublic && !(await verifySession(request.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|icon.svg).*)"],
};
