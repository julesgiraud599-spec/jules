import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pickOffer } from "@/lib/scoring";
import { PageHeader, Empty } from "@/components/ui";
import { ProductCard } from "@/components/product-card";

export default async function Saved() {
  const user = await requireUser();
  const saved = await db.savedProduct.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { product: { include: { offers: true } } } });
  return (
    <>
      <PageHeader title="Produits sauvegardés" subtitle={`${saved.length} produit(s) dans vos favoris.`} />
      {saved.length === 0 ? <Empty title="Aucun produit sauvegardé">Cliquez sur l&apos;icône signet d&apos;une fiche produit pour l&apos;ajouter ici.</Empty> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {saved.map((s) => <ProductCard key={s.productId} p={{ ...s.product, supplier: pickOffer(s.product.offers)?.supplier ?? null, saved: true }} />)}
        </div>
      )}
    </>
  );
}
