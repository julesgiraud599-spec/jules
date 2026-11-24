import { withApiUser, preflight } from "../_auth";
export const OPTIONS = preflight;
export const dynamic = "force-dynamic";
export const GET = (req: Request) => withApiUser(req, async () => ({ ok: true }));
