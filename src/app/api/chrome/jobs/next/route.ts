import { withApiUser, preflight } from "../../_auth";
export const OPTIONS = preflight;
import { claimNextJob } from "@/lib/chrome";
export const dynamic = "force-dynamic";
/** Appelé chaque minute par l'extension : signale qu'elle est connectée et récupère la prochaine recherche. */
export const GET = (req: Request) => withApiUser(req, async (u) => {
  const job = await claimNextJob(u.id);
  return { job: job ? { id: job.id, keyword: job.keyword } : null };
});
