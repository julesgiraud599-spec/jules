import { withApiUser, preflight } from "../../_auth";
export const OPTIONS = preflight;
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) => withApiUser(req, async (u) => {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const job = await db.chromeJob.findFirst({ where: { id, userId: u.id } });
  if (!job) throw new Error("Recherche introuvable");
  const status = ["ERROR", "BLOCKED"].includes(body.status) ? body.status : "ERROR";
  await db.chromeJob.update({ where: { id }, data: { status, error: String(body.error ?? "").slice(0, 500) || null, log: Array.isArray(body.log) ? body.log.map(String).join("\n").slice(0, 20000) : job.log, finishedAt: new Date() } });
  return { ok: true };
});
