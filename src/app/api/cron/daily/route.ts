import { NextResponse } from "next/server";
import { runDailyForAllUsers } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const force = new URL(req.url).searchParams.get("force") === "1";
  const results = await runDailyForAllUsers(force);
  return NextResponse.json({ ok: true, results });
}
export const GET = handle;
export const POST = handle;
