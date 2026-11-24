import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC = ["/login", "/register", "/api/cron", "/api/chrome"]; // /api/chrome : authentification par clé d API (Bearer)

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  const token = req.cookies.get("glacier_session")?.value;
  let ok = false;
  if (token && process.env.AUTH_SECRET) {
    try { await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET)); ok = true; } catch {}
  }
  if (!ok) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
