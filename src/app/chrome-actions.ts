"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { enqueueJobs, addToResearch, addToToday, newApiKey } from "@/lib/chrome";
import type { ActionState } from "./actions";

const s = (f: FormData, k: string) => (f.get(k) ?? "").toString().trim();
async function guard(fn: () => Promise<ActionState>): Promise<ActionState> {
  try { return await fn(); }
  catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    return { error: (e as Error).message };
  }
}

export async function enqueueChromeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const kws = s(f, "keywords").split(/\n|,/);
    const n = await enqueueJobs(user.id, kws, "DASHBOARD");
    if (!n) return { error: "Saisissez au moins un mot-clé (2 caractères minimum)." };
    revalidatePath("/chrome");
    const seen = user.chromeLastSeenAt && Date.now() - +user.chromeLastSeenAt < 5 * 60_000;
    return { ok: true, message: `${n} recherche(s) en file. ${seen ? "L'extension est connectée : la recherche démarre dans la minute." : "L'extension n'a pas été vue récemment : ouvrez Chrome avec l'extension Glacier configurée, sinon la recherche expirera."}` };
  });
}

export async function addChromeToResearchAction(f: FormData) {
  const user = await requireUser();
  const id = await addToResearch(user.id, s(f, "jobId"), s(f, "itemId") || null);
  revalidatePath("/chrome");
  redirect(`/products/${id}`);
}

export async function addToTodayAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    await addToToday(user.id, s(f, "productId"));
    revalidatePath("/daily"); revalidatePath(`/products/${s(f, "productId")}`);
    return { ok: true, message: "Ajouté au Top 10 du jour." };
  });
}

export async function generateApiKeyAction(_: ActionState): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const k = newApiKey();
    await db.user.update({ where: { id: user.id }, data: { apiKeyHash: k.hash, apiKeyPrefix: k.prefix } });
    revalidatePath("/settings");
    return { ok: true, message: `Nouvelle clé (affichée une seule fois, copiez-la maintenant) : ${k.key}` };
  });
}

export async function saveChromeKeywordsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireUser();
    const kws = s(f, "chromeKeywords").split(/\n|,/).map((k) => k.trim()).filter((k) => k.length >= 2).slice(0, 15);
    await db.user.update({ where: { id: user.id }, data: { chromeKeywords: kws.join("\n") || null } });
    revalidatePath("/settings");
    return { ok: true, message: `${kws.length} mot(s)-clé(s) recherché(s) chaque jour via Chrome.` };
  });
}

export async function cancelChromeJobAction(f: FormData) {
  const user = await requireUser();
  await db.chromeJob.updateMany({ where: { id: s(f, "jobId"), userId: user.id, status: "QUEUED" }, data: { status: "EXPIRED", error: "Annulée", finishedAt: new Date() } });
  revalidatePath("/chrome");
}
