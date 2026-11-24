import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { expireJobs } from "@/lib/chrome";
import { eur, num, NA, SUPPLIER_LABEL, searchLinks } from "@/lib/format";
import { PageHeader, Section, Empty, Stat, Thumb, LinkBadge, MatchBadge, SupplierBadge } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { enqueueChromeAction, addChromeToResearchAction, cancelChromeJobAction } from "@/app/chrome-actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, string]> = {
  QUEUED: ["En attente du navigateur", "border-sky-800 text-ice"], RUNNING: ["En cours dans Chrome", "border-sky-800 text-ice"],
  DONE: ["Terminée", "border-emerald-800 text-emerald-300"], PARTIAL: ["Partielle (site bloqué)", "border-amber-800 text-amber-300"],
  BLOCKED: ["Bloquée par Vinted", "border-amber-800 text-amber-300"], EXPIRED: ["Expirée", "border-line text-zinc-400"], ERROR: ["Erreur", "border-red-900 text-red-300"],
};
const ago = (d: Date | null) => { if (!d) return "jamais"; const m = Math.round((Date.now() - +d) / 60000); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`; };

export default async function ChromeSearch({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const sp = await searchParams;
  const user = await requireUser();
  await expireJobs(user.id);
  const jobs = await db.chromeJob.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30, include: { _count: { select: { items: true } } } });
  const selectedId = sp.job ?? jobs.find((j) => ["DONE", "PARTIAL", "BLOCKED"].includes(j.status))?.id;
  const job = selectedId ? await db.chromeJob.findFirst({ where: { id: selectedId, userId: user.id }, include: { items: { orderBy: [{ matchScore: { sort: "desc", nulls: "last" } }, { favorites: { sort: "desc", nulls: "last" } }] } } }) : null;
  const connected = user.chromeLastSeenAt && Date.now() - +user.chromeLastSeenAt < 3 * 60_000;
  const vinted = job?.items.filter((i) => i.role === "VINTED") ?? [];
  const sups = job?.items.filter((i) => i.role === "SUPPLIER") ?? [];
  const resale = job?.medianPrice != null ? Math.max(1, Math.floor(job.medianPrice * 0.95 * 2) / 2) : null;
  const blocked = job?.blocked ? (JSON.parse(job.blocked) as { site: string; reason: string }[]) : [];

  return (
    <>
      <PageHeader title="Recherche Chrome" subtitle="Recherches menées dans votre propre navigateur par l'extension Glacier : Vinted pour la demande, AliExpress et Temu pour le même produit. Aucun cookie ni mot de passe n'est transmis." />

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Section title="Extension Chrome">
          <div className="flex items-center gap-2 text-sm"><span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400" : "bg-zinc-600"}`} />{connected ? "Connectée" : "Non connectée"} <span className="text-xs text-muted">· dernière visite {ago(user.chromeLastSeenAt)}</span></div>
          <p className="mt-2 text-xs text-muted">{user.apiKeyPrefix ? `Clé d'API active (${user.apiKeyPrefix}…).` : "Aucune clé d'API : créez-en une dans Paramètres."} Les recherches s&apos;exécutent seulement quand Chrome est ouvert avec l&apos;extension. Sinon elles expirent au bout de 8 h, et la raison est affichée.</p>
          <Link href="/settings#chrome" className="mt-3 inline-block text-xs text-ice hover:underline">Configurer l&apos;extension →</Link>
        </Section>
        <Section title="Lancer une recherche" className="lg:col-span-2">
          <ActionForm action={enqueueChromeAction} resetOnSuccess className="space-y-3">
            <textarea name="keywords" rows={3} required className="input" placeholder={"Un produit par ligne (sans marque), par exemple :\npince à cheveux XXL\nécharpe à franges"} />
            <div className="flex flex-wrap items-center gap-3"><Submit>Lancer dans Chrome</Submit><span className="text-xs text-muted">Une page toutes les quelques secondes. La recherche s&apos;arrête dès qu&apos;un site affiche un CAPTCHA ou demande une connexion.</span></div>
          </ActionForm>
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-4">
        <Section title="Recherches" className="xl:col-span-1">
          {jobs.length === 0 ? <p className="text-sm text-muted">Aucune recherche.</p> : (
            <ul className="space-y-2">
              {jobs.map((j) => { const [label, tone] = STATUS[j.status] ?? [j.status, ""]; return (
                <li key={j.id} className={`rounded-lg border p-2.5 ${j.id === job?.id ? "border-sky-800 bg-ice-soft/30" : "border-line"}`}>
                  <Link href={`/chrome?job=${j.id}`} className="block text-sm text-zinc-100 hover:text-ice">{j.keyword}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted"><span className={`badge ${tone}`}>{label}</span>{j.source.toLowerCase()} · {ago(j.createdAt)} · {j._count.items} élément(s)</div>
                  {j.error && <div className="mt-1 text-[11px] text-amber-300/90">{j.error}</div>}
                  {j.status === "QUEUED" && <form action={cancelChromeJobAction} className="mt-1"><input type="hidden" name="jobId" value={j.id} /><button className="text-[11px] text-muted hover:text-red-300">Annuler</button></form>}
                </li>); })}
            </ul>
          )}
        </Section>

        <div className="space-y-6 xl:col-span-3">
          {!job ? <Empty title="Aucun résultat à afficher">Lancez une recherche ci-dessus, ou depuis l&apos;extension (« Lancer une recherche » / « Analyser cette page »), ou depuis Claude Code.</Empty> : (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Annonces Vinted (total affiché)" value={num(job.resultCount)} hint={`${job.vintedRead ?? vinted.length} lue(s)`} />
                <Stat label="Prix médian observé" value={eur(job.medianPrice)} hint={resale !== null ? `Revente conseillée ${eur(resale)}` : undefined} />
                <Stat label="Favoris visibles (total)" value={num(job.favorites)} hint="Intérêt, pas des ventes" />
                <Stat label="Fournisseurs vérifiés" value={`${sups.filter((s) => s.linkStatus === "VERIFIED").length} / ${sups.length}`} hint="Fiche ouverte dans Chrome" />
              </div>
              {blocked.length > 0 && <p className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">Bloqué : {blocked.map((b) => `${b.site} (${b.reason})`).join(" · ")}. Ouvrez le site dans Chrome, résolvez la vérification vous-même, puis relancez la recherche.</p>}

              <Section title={`Correspondances fournisseurs (${sups.length})`} action={<a href={searchLinks(job.keyword).vinted} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm"><ExternalLink size={13} />VOIR LES ANNONCES VINTED</a>}>
                {sups.length === 0 ? <p className="text-sm text-muted">Aucun produit fournisseur relevé pour cette recherche.</p> : (
                  <div className="-mx-4 overflow-x-auto"><table className="w-full min-w-[820px]">
                    <thead><tr><th className="th">Produit fournisseur</th><th className="th text-right">Achat</th><th className="th text-right">Marge brute</th><th className="th">Lien</th><th className="th">Correspondance</th><th className="th" /></tr></thead>
                    <tbody>{sups.map((s) => {
                      const photo = (JSON.parse(s.photos) as string[])[0];
                      const margin = resale !== null && s.price !== null ? resale - s.price : null;
                      const md = s.matchDetail ? (JSON.parse(s.matchDetail) as { signals: { label: string; score: number | null; detail: string }[]; visualNote?: string | null }) : null;
                      return (
                        <tr key={s.id}>
                          <td className="td max-w-[300px] align-top"><div className="flex gap-2"><Thumb src={photo} alt="" className="h-12 w-12 shrink-0 rounded" /><div className="min-w-0"><div className="line-clamp-2 text-xs text-zinc-100">{s.title ?? NA}</div><div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted"><SupplierBadge supplier={s.site} />{s.orders !== null && `${num(s.orders)} vendus (affiché)`}</div><a href={s.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] text-ice hover:underline"><ExternalLink size={11} />VOIR LE PRODUIT FOURNISSEUR</a></div></div></td>
                          <td className="td text-right align-top tabular-nums">{eur(s.price)}</td>
                          <td className="td text-right align-top tabular-nums">{margin === null ? <span className="text-muted">{NA}</span> : <span className={margin > 0 ? "text-emerald-300" : "text-red-300"}>{eur(margin)}{s.price ? <div className="text-[10px] text-muted">×{(resale! / s.price).toFixed(1)}</div> : null}</span>}</td>
                          <td className="td align-top"><LinkBadge status={s.linkStatus} />{s.linkReason && <div className="mt-1 max-w-[180px] text-[10px] text-muted">{s.linkReason}</div>}</td>
                          <td className="td align-top"><MatchBadge status={s.matchStatus} score={s.matchScore} />{md && <details className="mt-1 text-[10px] text-muted"><summary className="cursor-pointer">Détail</summary><ul>{md.signals.map((g, i) => <li key={i}>{g.label} : {g.score === null ? NA : `${g.score}/100`}</li>)}</ul>{md.visualNote && <div>{md.visualNote}</div>}</details>}</td>
                          <td className="td align-top">{s.productId ? <Link href={`/products/${s.productId}`} className="btn-ghost btn-sm">Ouvrir la fiche</Link> : s.linkStatus !== "INVALID" && s.price !== null && <form action={addChromeToResearchAction}><input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="itemId" value={s.id} /><button className="btn-primary btn-sm">Ajouter à Product Research</button></form>}</td>
                        </tr>); })}</tbody>
                  </table></div>
                )}
                <p className="mt-3 text-[11px] text-zinc-500">« Vérifié » = la fiche a été ouverte dans votre Chrome et son titre correspond. « Même produit » exige la comparaison des photos (IA) ou votre confirmation sur la fiche produit. Une correspondance « incertaine » n&apos;entre jamais dans le Top 10.</p>
              </Section>

              <Section title={`Annonces Vinted relevées (${vinted.length})`} action={!vinted.some((v) => v.productId) && vinted.length > 0 ? <form action={addChromeToResearchAction}><input type="hidden" name="jobId" value={job.id} /><input type="hidden" name="itemId" value="" /><button className="btn-ghost btn-sm">Suivre sans fournisseur</button></form> : undefined}>
                {vinted.length === 0 ? <p className="text-sm text-muted">Aucune annonce lue.</p> : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                    {vinted.slice(0, 30).map((v) => (
                      <a key={v.id} href={v.url} target="_blank" rel="noopener noreferrer" className="card overflow-hidden hover:border-zinc-700">
                        <Thumb src={(JSON.parse(v.photos) as string[])[0]} alt="" className="aspect-square w-full" />
                        <div className="p-2"><div className="line-clamp-2 text-xs text-zinc-200">{v.title ?? NA}</div><div className="mt-1 flex justify-between text-[11px] tabular-nums"><span>{eur(v.price)}</span><span className={v.favorites === null ? "text-zinc-600" : "text-muted"}>{v.favorites === null ? "♥ n/d" : `${v.favorites} ♥`}</span></div></div>
                      </a>
                    ))}
                  </div>
                )}
              </Section>

              {job.log && <Section title="Journal de la recherche"><pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-400">{job.log}</pre></Section>}
            </>
          )}
        </div>
      </div>
      <p className="mt-6 text-[11px] text-zinc-600">Fournisseurs couverts : {Object.values(SUPPLIER_LABEL).filter((s) => s !== "SHEIN").join(", ")} (SHEIN n&apos;est pas encore intégré à l&apos;extension).</p>
    </>
  );
}
