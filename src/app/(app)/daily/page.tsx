import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayKey, eur } from "@/lib/format";
import { pickOffer } from "@/lib/scoring";
import { PageHeader, Empty, Stat } from "@/components/ui";
import { ProductCard } from "@/components/product-card";
import { ActionForm, Submit } from "@/components/action-form";
import { runDailyAction } from "@/app/actions";

export default async function Daily() {
  const user = await requireUser();
  const today = dayKey();
  const sel = await db.dailySelection.findUnique({
    where: { userId_date: { userId: user.id, date: today } },
    include: { items: { orderBy: { rank: "asc" }, include: { product: { include: { offers: true, savedBy: { where: { userId: user.id } } } } } } },
  });
  const margin = sel?.items.reduce((a, i) => a + (i.product.grossMargin ?? 0), 0) ?? 0;
  return (
    <>
      <PageHeader title="TOP 10 PRODUITS DU JOUR" subtitle={`Les meilleures opportunités vérifiées du ${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} : favoris Vinted relevés, correspondance fournisseur fiable et lien vérifié. Sans répétition des ${user.repeatCooldownDays} derniers jours.`}>
        <ActionForm action={runDailyAction}>
          <input type="hidden" name="force" value={sel ? "1" : "0"} />
          <Submit pendingText="Analyse en cours…">{sel ? "Régénérer la sélection" : "Lancer la sélection maintenant"}</Submit>
        </ActionForm>
      </PageHeader>
      {!sel ? (
        <Empty title="La sélection du jour n'a pas encore été générée">Elle se lance automatiquement chaque matin (tâche planifiée), ou tout de suite avec le bouton ci-dessus. Un produit n'entre dans le Top 10 que si ses favoris Vinted sont relevés, si l'offre fournisseur correspond de façon fiable au produit Vinted et si son lien est vérifié. Le système ne complète jamais la liste avec des produits non vérifiés.</Empty>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Produits sélectionnés" value={`${sel.items.length} / 10`} />
            <Stat label="Meilleur score" value={sel.items[0] ? `${sel.items[0].score}/100` : "—"} accent />
            <Stat label="Marge brute cumulée (1 unité chacun)" value={eur(margin)} />
            <Stat label="Générée à" value={sel.createdAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} />
          </div>
          {sel.note && <p className="mb-4 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">{sel.note}</p>}
          {sel.items.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {sel.items.map((i) => <ProductCard key={i.id} p={{ ...i.product, rank: i.rank, supplier: pickOffer(i.product.offers)?.supplier ?? null, linkStatus: pickOffer(i.product.offers)?.linkStatus ?? null, saved: i.product.savedBy.length > 0 }} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}
