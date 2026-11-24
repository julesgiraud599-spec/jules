import { withApiUser, preflight } from "../_auth";
export const OPTIONS = preflight;
import { ingest } from "@/lib/chrome";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export const POST = (req: Request) => withApiUser(req, async (u) => {
  const text = await req.text();
  if (text.length > 2_000_000) throw new Error("Résultat trop volumineux");
  return ingest(u.id, JSON.parse(text));
});
