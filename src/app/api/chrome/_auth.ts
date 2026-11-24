import { NextResponse } from "next/server";
import { userFromRequest } from "@/lib/chrome";

/** CORS limité aux extensions Chrome : l'authentification se fait par clé d'API (jamais par cookie). */
export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  return /^chrome-extension:\/\/[a-p]{32}$/.test(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" }
    : {};
}
export const preflight = (req: Request) => new NextResponse(null, { status: 204, headers: cors(req) });

export async function withApiUser<T>(req: Request, fn: (user: NonNullable<Awaited<ReturnType<typeof userFromRequest>>>) => Promise<T>) {
  const headers = cors(req);
  const user = await userFromRequest(req);
  if (!user) return NextResponse.json({ error: "Clé d'API Glacier invalide ou absente (Paramètres → Recherche Chrome)." }, { status: 401, headers });
  try { return NextResponse.json(await fn(user), { headers }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400, headers }); }
}
