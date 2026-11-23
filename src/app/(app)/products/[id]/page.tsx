import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Bookmark, BookmarkCheck, Sparkles, Trash2, Check } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { scoreProduct } from "@/lib/engine";
import { aliexpressConfigured } from "@/lib/aliexpress";
import { aiConfigured, type Analysis } from "@/lib/ai";
import { pickOffer } from "@/lib/scoring";
import { eur, pct, num, dateFr, NA, CATEGORIES, SUPPLIER_LABEL, searchLinks } from "@/lib/format";
import { PageHeader, Section, ScoreBadge, Level, SupplierBadge, Thumb, Empty } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { Disclosure } from "@/components/disclosure";
import {
  addListingAction, importListingsAction, deleteListingAction, setCompetitorCountAction, addOfferAction,
  toggleOfferConfirmAction, deleteOfferAction, fetchAliExpressAction, generateAnalysisAction, toggleSaveAction,
  deleteProductAction, updateProductAction,
} from "@/app/actions";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const p = await db.product.findFirst({
    where: { id, userId: user.id },
    include: {
      listings: { include: { snapshots: { orderBy: { capturedAt: "asc" } } }, orderBy: { favorites: { sort: "desc", nulls: "last" } } },
      offers: { orderBy: { price: "asc" } },
      analyses: { orderBy: { createdAt: "desc" }, take: 1 },
      savedBy: { where: { userId: user.id } },
      competitorSnapshots: { orderBy: { capturedAt: "desc" }, take: 5 },
    },
  });
  if (!p) notFound();
  const r = await scoreProduct(p.id);
  const m = r.metrics;
  const best = pickOffer(p.offers);
  const saved = p.savedBy.length > 0;
  const analysis = p.analyses[0] ? (JSON.parse(p.analyses[0].content) as Analysis) : null;
  const links = searchLinks(p.keywords);
  const hidden = <input type="hidden" name="productId" value={p.id} />;

  const metrics: [string, React.ReactNode, string?][] = [
    ["Prix d'achat (port inclus)", eur(m.purchaseCost), best ? `${SUPPLIER_LABEL[best.supplier]}${best.confirmed ? "" : " · correspondance non vérifiée"}` : "Aucune offre liée"],
    ["Prix moyen observé sur Vinted", eur(m.avgSoldPrice ?? m.avgPrice), m.avgSoldPrice !== null ? "Moyenne des annonces vendues" : m.avgPrice !== null ? "Moyenne des annonces en ligne (aucune vente constatée)" : undefined],
    ["Prix de revente conseillé", eur(m.recommendedPrice), "Légèrement sous la médiane observée"],
    ["Marge brute estimée", eur(m.grossMargin)],
    ["Marge (%)", pct(m.marginPct)],
    ["Marge nette estimée", eur(m.netMargin), `Après emballage (${eur(user.packagingCost)}) et cotisations (${user.contributionRate} %)`],
    ["Favoris observés", num(m.totalFavorites), m.medianFavorites !== null ? `Médiane ${m.medianFavorites} par annonce` : undefined],
    ["Vues", num(m.totalViews), m.totalViews === null ? "Rarement affichées par Vinted" : undefined],
    ["Ventes confirmées", `${m.confirmedSales} / ${m.observedListings} annonces`, "Annonces vues avec le statut « Vendu »"],
    ["Annonces concurrentes", num(m.competitorCount), p.competitorCountAt ? `Relevé le ${dateFr(p.competitorCountAt)}` : undefined],
    ["Évolution de la demande", m.favoritesGrowthPerDay === null ? NA : `${m.favoritesGrowthPerDay > 0 ? "+" : ""}${m.favoritesGrowthPerDay} favoris / jour`],
    ["Rapport demande / offre", m.demandSupplyRatio === null ? NA : `${m.demandSupplyRatio} fav. / annonce`],
    ["Délai de vente observé", m.observedDaysToSell === null ? NA : `${m.observedDaysToSell} j`, m.observedDaysToSell !== null ? "Entre 1re observation et vente constatée" : undefined],
    ["Fourchette de prix Vinted", m.minPrice === null ? NA : `${eur(m.minPrice)} – ${eur(m.maxPrice)}`],
    ["Date de détection", dateFr(p.createdAt)],
  ];

  return (
    <>
      <div className="mb-4 text-xs text-muted"><Link href="/research" className="hover:text-zinc-200">Product Research</Link> / {p.name}</div>

      {/* En-tête */}
      <div className="card mb-6 flex flex-col gap-5 p-4 md:flex-row md:items-center">
        <Thumb src={p.imageUrl ?? best?.imageUrl} alt={p.name} className="h-40 w-full rounded-lg md:h-28 md:w-28" />
        <div className="flex-1">
          <h1 className="h1">{p.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted">{p.category} · <SupplierBadge supplier={best?.supplier} /> · Demande <Level value={r.demandLevel} /> · Concurrence <Level value={r.competitionLevel} inverse /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            {best ? <a href={best.url} target="_blank" rel="noopener noreferrer" className="btn-primary"><ExternalLink size={15} />Voir le produit fournisseur</a>
              : <span className="btn-ghost cursor-not-allowed opacity-60" title="Ajoutez d'abord une offre fournisseur">Aucun produit fournisseur lié</span>}
            <form action={toggleSaveAction}>{hidden}<button className="btn-ghost">{saved ? <><BookmarkCheck size={15} className="text-ice" />Sauvegardé</> : <><Bookmark size={15} />Sauvegarder</>}</button></form>
            <a href={links.vinted} target="_blank" rel="noopener noreferrer" className="btn-ghost"><ExternalLink size={15} />Rechercher sur Vinted</a>
          </div>
        </div>
        <ScoreBadge score={r.score} confidence={r.confidence} size="lg" />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Section title="Indicateurs">
            <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              {metrics.map(([k, v, hint]) => (
                <div key={k} className="bg-panel p-3">
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className={`mt-1 text-base font-medium tabular-nums ${v === NA ? "text-zinc-500" : "text-zinc-100"}`}>{v}</dd>
                  {hint && <div className="mt-0.5 text-[11px] text-zinc-500">{hint}</div>}
                </div>
              ))}
            </dl>
          </Section>

          <Section title="Analyse IA" action={aiConfigured() && <ActionForm action={generateAnalysisAction}>{hidden}<Submit variant="ghost" className="btn-sm" pendingText="Analyse en cours…"><Sparkles size={14} />{analysis ? "Régénérer" : "Analyser"}</Submit></ActionForm>}>
            {!aiConfigured() ? <p className="text-sm text-muted">Ajoutez <code className="text-ice">ANTHROPIC_API_KEY</code> dans le fichier <code>.env</code> pour activer l&apos;analyse IA.</p>
              : !analysis ? <p className="text-sm text-muted">Aucune analyse pour l&apos;instant. L&apos;IA ne s&apos;appuie que sur les données observées ci-dessous.</p>
              : (
                <div className="space-y-4 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${analysis.verdict === "Bonne opportunité" ? "border-emerald-800 text-emerald-300" : analysis.verdict === "À éviter" ? "border-red-900 text-red-300" : "border-sky-800 text-ice"}`}>{analysis.verdict}</span>
                    <span className="badge border-line text-zinc-300">Tendance : {analysis.tendance}</span>
                    <span className="text-xs text-zinc-500">Généré le {dateFr(p.analyses[0].createdAt)}</span>
                  </div>
                  {([["Pourquoi ce produit peut se vendre", analysis.pourquoi], ["Tendance passagère ou durable ?", analysis.tendance_explication], ["Concurrence", analysis.concurrence],
                    ["Prix de revente conseillé", `${analysis.prix_conseille !== null ? eur(analysis.prix_conseille) + " : " : ""}${analysis.prix_explication}`], ["Marge espérée", analysis.marge_esperee]] as const).map(([k, v]) => (
                    <div key={k}><div className="text-xs font-medium text-muted">{k}</div><p className="mt-1 text-zinc-200">{v}</p></div>
                  ))}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div><div className="text-xs font-medium text-muted">Risques</div><ul className="mt-1 list-disc space-y-1 pl-4 text-zinc-300">{analysis.risques.map((x) => <li key={x}>{x}</li>)}</ul></div>
                    <div><div className="text-xs font-medium text-muted">Conseils d&apos;annonce</div><ul className="mt-1 list-disc space-y-1 pl-4 text-zinc-300">{analysis.conseils_annonce.map((x) => <li key={x}>{x}</li>)}</ul></div>
                  </div>
                </div>
              )}
          </Section>

          <Section title={`Annonces Vinted observées (${p.listings.length})`}>
            {p.listings.length === 0 ? <Empty title="Aucune annonce observée">Ajoutez les annonces Vinted similaires que vous repérez. Chaque mise à jour crée un relevé daté pour suivre l&apos;évolution des favoris.</Empty> : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead><tr><th className="th">Annonce</th><th className="th text-right">Prix</th><th className="th text-right">Favoris</th><th className="th text-right">Vues</th><th className="th">Statut</th><th className="th">Relevés</th><th className="th" /></tr></thead>
                  <tbody>
                    {p.listings.map((l) => {
                      const s = l.snapshots.filter((x) => x.favorites !== null);
                      const delta = s.length >= 2 ? (s[s.length - 1].favorites as number) - (s[0].favorites as number) : null;
                      return (
                        <tr key={l.id}>
                          <td className="td max-w-[260px]"><a href={l.url} target="_blank" rel="noopener noreferrer" className="line-clamp-1 hover:text-ice">{l.title}</a><div className="text-[11px] text-zinc-500">Vu le {dateFr(l.firstSeenAt)}</div></td>
                          <td className="td text-right tabular-nums">{eur(l.price)}</td>
                          <td className="td text-right tabular-nums">{num(l.favorites)}{delta !== null && delta !== 0 && <span className={`ml-1 text-[11px] ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>{delta > 0 ? "+" : ""}{delta}</span>}</td>
                          <td className="td text-right tabular-nums text-muted">{num(l.views)}</td>
                          <td className="td">{l.status === "SOLD" ? <span className="badge border-emerald-800 text-emerald-300">Vendu (confirmé)</span> : <span className="badge border-line text-zinc-400">En ligne</span>}</td>
                          <td className="td text-xs text-muted">{l.snapshots.length}</td>
                          <td className="td text-right"><form action={deleteListingAction}><input type="hidden" name="listingId" value={l.id} /><button aria-label="Supprimer" className="text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button></form></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <Disclosure className="mt-4 rounded-lg border border-line p-3" defaultOpen={p.listings.length === 0} summary={<>Ajouter ou mettre à jour une annonce</>}>
              <p className="mt-1 text-xs text-muted">Re-saisir une annonce existante (même lien) met à jour ses chiffres et ajoute un relevé daté. Laissez « Favoris » ou « Vues » vides s&apos;ils ne sont pas affichés.</p>
              <ActionForm action={addListingAction} resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-6">
                {hidden}
                <div className="sm:col-span-3"><label className="label">Lien de l&apos;annonce Vinted *</label><input name="url" type="url" required className="input" placeholder="https://www.vinted.fr/items/…" /></div>
                <div className="sm:col-span-3"><label className="label">Titre *</label><input name="title" required className="input" /></div>
                <div><label className="label">Prix (€) *</label><input name="price" type="number" step="0.01" min="0" required className="input" /></div>
                <div><label className="label">Favoris</label><input name="favorites" type="number" min="0" className="input" /></div>
                <div><label className="label">Vues</label><input name="views" type="number" min="0" className="input" /></div>
                <div><label className="label">Statut</label><select name="status" className="input"><option value="ACTIVE">En ligne</option><option value="SOLD">Vendu</option></select></div>
                <div className="sm:col-span-2"><label className="label">URL photo</label><input name="photoUrl" type="url" className="input" /></div>
                <div className="sm:col-span-6"><Submit>Enregistrer l&apos;annonce</Submit></div>
              </ActionForm>
            </Disclosure>
            <Disclosure className="mt-3 rounded-lg border border-line p-3" summary={<>Import en masse (CSV / tableur)</>}>
              <p className="mt-1 text-xs text-muted">Une annonce par ligne, séparateur « ; » ou tabulation : <code className="text-ice">url;titre;prix;favoris;vues;statut</code> (statut : « vendu » ou vide).</p>
              <ActionForm action={importListingsAction} resetOnSuccess className="mt-3 space-y-3">
                {hidden}
                <textarea name="csv" rows={5} required className="input font-mono text-xs" placeholder={"https://www.vinted.fr/items/123;Pince XXL écaille;6;34;;\nhttps://www.vinted.fr/items/456;Lot 3 pinces;9;12;;vendu"} />
                <Submit variant="ghost">Importer</Submit>
              </ActionForm>
            </Disclosure>
          </Section>

          <Section title="Offres fournisseurs" action={aliexpressConfigured() && <ActionForm action={fetchAliExpressAction}>{hidden}<Submit variant="ghost" className="btn-sm" pendingText="Recherche…">Rechercher sur AliExpress (API)</Submit></ActionForm>}>
            <div className="mb-3 flex flex-wrap gap-2 text-xs">
              <span className="text-muted">Rechercher « {p.keywords} » sur :</span>
              {(["ALIEXPRESS", "TEMU", "SHEIN"] as const).map((s) => <a key={s} href={links[s]} target="_blank" rel="noopener noreferrer" className="text-ice hover:underline">{SUPPLIER_LABEL[s]} ↗</a>)}
            </div>
            {!aliexpressConfigured() && <p className="mb-3 rounded-lg border border-line bg-panel2 p-2.5 text-xs text-muted">La recherche AliExpress automatique utilise l&apos;API officielle Affiliés. Elle s&apos;active avec <code className="text-ice">ALIEXPRESS_APP_KEY</code> et <code className="text-ice">ALIEXPRESS_APP_SECRET</code>. Temu et SHEIN n&apos;ont pas d&apos;API publique de catalogue, il faut ajouter leurs offres à la main.</p>}
            {p.offers.length === 0 ? <Empty title="Aucune offre liée">Sans offre fournisseur, la marge et le score restent incomplets et le produit ne peut pas entrer dans la sélection du jour.</Empty> : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[620px]">
                  <thead><tr><th className="th">Produit</th><th className="th">Fournisseur</th><th className="th text-right">Prix</th><th className="th text-right">Port</th><th className="th text-right">Ventes fourn.</th><th className="th">Correspondance</th><th className="th" /></tr></thead>
                  <tbody>{p.offers.map((o) => (
                    <tr key={o.id} className={best?.id === o.id ? "bg-ice-soft/20" : ""}>
                      <td className="td max-w-[240px]"><div className="flex items-center gap-2"><Thumb src={o.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded" /><a href={o.url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-xs hover:text-ice">{o.title}</a></div></td>
                      <td className="td"><SupplierBadge supplier={o.supplier} /><div className="mt-0.5 text-[10px] text-zinc-500">{o.source === "API" ? "API officielle" : "Saisie manuelle"}</div></td>
                      <td className="td text-right tabular-nums">{eur(o.price)}</td>
                      <td className="td text-right tabular-nums text-muted">{eur(o.shipping)}</td>
                      <td className="td text-right tabular-nums text-muted">{num(o.salesVolume)}</td>
                      <td className="td"><form action={toggleOfferConfirmAction}><input type="hidden" name="offerId" value={o.id} /><button className={`badge ${o.confirmed ? "border-emerald-800 text-emerald-300" : "border-amber-800 text-amber-300"}`}>{o.confirmed ? <><Check size={11} />Vérifiée</> : "À vérifier"}</button></form></td>
                      <td className="td text-right"><form action={deleteOfferAction}><input type="hidden" name="offerId" value={o.id} /><button aria-label="Supprimer" className="text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button></form></td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
            )}
            <Disclosure className="mt-4 rounded-lg border border-line p-3" defaultOpen={p.offers.length === 0} summary={<>Ajouter une offre (Temu, SHEIN, AliExpress)</>}>
              <ActionForm action={addOfferAction} resetOnSuccess className="mt-3 grid gap-3 sm:grid-cols-6">
                {hidden}
                <div className="sm:col-span-2"><label className="label">Fournisseur *</label><select name="supplier" className="input">{Object.entries(SUPPLIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="sm:col-span-4"><label className="label">Lien du produit *</label><input name="url" type="url" required className="input" placeholder="https://…" /></div>
                <div className="sm:col-span-3"><label className="label">Titre</label><input name="title" className="input" /></div>
                <div><label className="label">Prix unitaire (€) *</label><input name="price" type="number" step="0.01" min="0" required className="input" /></div>
                <div><label className="label">Port / unité (€)</label><input name="shipping" type="number" step="0.01" min="0" className="input" /></div>
                <div><label className="label">URL photo</label><input name="imageUrl" type="url" className="input" /></div>
                <div className="sm:col-span-6"><Submit>Ajouter l&apos;offre</Submit></div>
              </ActionForm>
            </Disclosure>
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Détail du score">
            <ul className="space-y-3">
              {r.components.map((c) => (
                <li key={c.key}>
                  <div className="flex items-center justify-between text-sm"><span className="text-zinc-200">{c.label} <span className="text-[11px] text-zinc-500">×{c.weight}</span></span><span className={`tabular-nums ${c.score === null ? "text-zinc-500" : "text-zinc-100"}`}>{c.score === null ? NA : Math.round(c.score)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel2"><div className="h-full rounded-full bg-ice transition-all" style={{ width: `${c.score ?? 0}%` }} /></div>
                  <div className="mt-1 text-[11px] text-zinc-500">{c.detail}</div>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-zinc-500">Le score est la moyenne pondérée des critères qui ont des données. Les critères « Non disponible » sont exclus et le score est réduit en fonction des données manquantes (×{(0.6 + 0.4 * r.confidence / 100).toFixed(2)}).</p>
          </Section>

          <Section title="Concurrence sur Vinted">
            <p className="mb-3 text-xs text-muted">Ouvrez <a href={links.vinted} target="_blank" rel="noopener noreferrer" className="text-ice hover:underline">la recherche Vinted ↗</a> et reportez le nombre de résultats affiché.</p>
            <ActionForm action={setCompetitorCountAction} className="flex gap-2">
              {hidden}<input name="competitorCount" type="number" min="0" defaultValue={p.competitorCount ?? ""} className="input" placeholder="Nombre d'annonces" /><Submit variant="ghost">OK</Submit>
            </ActionForm>
            {p.competitorSnapshots.length > 1 && <ul className="mt-3 space-y-1 text-xs text-muted">{p.competitorSnapshots.map((s) => <li key={s.id} className="flex justify-between"><span>{dateFr(s.capturedAt)}</span><span className="tabular-nums">{s.count}</span></li>)}</ul>}
          </Section>

          <Section title="Modifier la fiche">
            <ActionForm action={updateProductAction} className="space-y-3">
              {hidden}
              <div><label className="label">Nom</label><input name="name" defaultValue={p.name} className="input" /></div>
              <div><label className="label">Catégorie</label><select name="category" defaultValue={p.category} className="input">{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div><label className="label">Mots-clés</label><input name="keywords" defaultValue={p.keywords} className="input" /></div>
              <div><label className="label">URL photo</label><input name="imageUrl" type="url" defaultValue={p.imageUrl ?? ""} className="input" /></div>
              <div><label className="label">Notes</label><textarea name="notes" rows={2} defaultValue={p.notes ?? ""} className="input" /></div>
              <Submit variant="ghost">Enregistrer</Submit>
            </ActionForm>
            <form action={deleteProductAction} className="mt-4 border-t border-line pt-4">{hidden}<button className="btn-danger btn-sm"><Trash2 size={13} />Supprimer le produit</button></form>
          </Section>
        </div>
      </div>
    </>
  );
}
