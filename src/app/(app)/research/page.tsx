import Link from "next/link";
import { Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CATEGORIES, SUPPLIER_LABEL } from "@/lib/format";
import { pickOffer } from "@/lib/scoring";
import { PageHeader, Empty } from "@/components/ui";
import { ProductCard } from "@/components/product-card";

type SP = Record<string, string | undefined>;
const n = (v?: string) => (v && v !== "" && Number.isFinite(Number(v)) ? Number(v) : undefined);

export default async function Research({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireUser();
  const where: Prisma.ProductWhereInput = { userId: user.id };
  const and: Prisma.ProductWhereInput[] = [];
  if (sp.q) and.push({ OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { keywords: { contains: sp.q, mode: "insensitive" } }, { category: { contains: sp.q, mode: "insensitive" } }] });
  if (sp.category) and.push({ category: sp.category });
  if (sp.supplier) and.push({ offers: { some: { supplier: sp.supplier } } });
  if (n(sp.maxBuy) !== undefined) and.push({ purchasePrice: { lte: n(sp.maxBuy) } });
  if (n(sp.minResale) !== undefined) and.push({ recommendedPrice: { gte: n(sp.minResale) } });
  if (n(sp.maxResale) !== undefined) and.push({ recommendedPrice: { lte: n(sp.maxResale) } });
  if (n(sp.minMargin) !== undefined) and.push({ marginPct: { gte: n(sp.minMargin) } });
  if (n(sp.minFav) !== undefined) and.push({ totalFavorites: { gte: n(sp.minFav) } });
  if (n(sp.minScore) !== undefined) and.push({ score: { gte: n(sp.minScore) } });
  if (sp.competition) and.push({ competitionLevel: sp.competition });
  if (n(sp.days) !== undefined) and.push({ createdAt: { gte: new Date(Date.now() - (n(sp.days) as number) * 86_400_000) } });
  if (and.length) where.AND = and;

  const orderBy: Prisma.ProductOrderByWithRelationInput =
    sp.sort === "recent" ? { createdAt: "desc" } : sp.sort === "margin" ? { marginPct: { sort: "desc", nulls: "last" } } :
    sp.sort === "favorites" ? { totalFavorites: { sort: "desc", nulls: "last" } } : { score: { sort: "desc", nulls: "last" } };

  const [products, total] = await Promise.all([
    db.product.findMany({ where, orderBy, include: { offers: true, savedBy: { where: { userId: user.id } } }, take: 120 }),
    db.product.count({ where: { userId: user.id } }),
  ]);
  const F = ({ name, label, ...rest }: { name: string; label: string } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <div><label className="label" htmlFor={name}>{label}</label><input id={name} name={name} defaultValue={sp[name] ?? ""} className="input" {...rest} /></div>
  );

  return (
    <>
      <PageHeader title="Product Research" subtitle="Partez de la demande observée sur Vinted, retrouvez le produit chez AliExpress, Temu ou SHEIN.">
        <Link href="/research/new" className="btn-primary"><Plus size={16} />Nouvelle recherche</Link>
      </PageHeader>

      <form className="card mb-6 p-4" method="get">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Rechercher un produit, un mot-clé, une catégorie…" className="input flex-1" />
          <select name="sort" defaultValue={sp.sort ?? "score"} className="input sm:w-48">
            <option value="score">Trier : score</option><option value="recent">Plus récents</option><option value="margin">Marge %</option><option value="favorites">Favoris</option>
          </select>
          <button className="btn-primary">Rechercher</button>
        </div>
        <details className="mt-3" open={Object.keys(sp).some((k) => !["q", "sort"].includes(k) && sp[k])}>
          <summary className="cursor-pointer text-xs text-muted hover:text-zinc-200">Filtres avancés</summary>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            <div><label className="label">Fournisseur</label><select name="supplier" defaultValue={sp.supplier ?? ""} className="input"><option value="">Tous</option>{Object.entries(SUPPLIER_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="label">Catégorie</label><select name="category" defaultValue={sp.category ?? ""} className="input"><option value="">Toutes</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
            <F name="maxBuy" label="Prix d'achat max (€)" type="number" step="0.01" min="0" />
            <F name="minResale" label="Revente min (€)" type="number" step="0.5" min="0" />
            <F name="maxResale" label="Revente max (€)" type="number" step="0.5" min="0" />
            <F name="minMargin" label="Marge min (%)" type="number" min="0" max="100" />
            <F name="minFav" label="Favoris min" type="number" min="0" />
            <F name="minScore" label="Score min" type="number" min="0" max="100" />
            <div><label className="label">Concurrence</label><select name="competition" defaultValue={sp.competition ?? ""} className="input"><option value="">Toutes</option><option>Faible</option><option>Moyenne</option><option>Forte</option></select></div>
            <div><label className="label">Détectés depuis</label><select name="days" defaultValue={sp.days ?? ""} className="input"><option value="">Toujours</option><option value="1">24 h</option><option value="7">7 jours</option><option value="30">30 jours</option></select></div>
            <div className="col-span-2 flex items-end gap-2"><button className="btn-primary">Appliquer</button><Link href="/research" className="btn-ghost">Réinitialiser</Link></div>
          </div>
        </details>
      </form>

      <div className="mb-3 text-xs text-muted">{products.length} résultat(s) sur {total} produit(s) suivi(s)</div>
      {products.length === 0 ? (
        <Empty title={total === 0 ? "Aucun produit suivi pour l'instant" : "Aucun produit ne correspond aux filtres"}>
          {total === 0 && <>Créez une recherche, ajoutez les annonces Vinted que vous observez (favoris, prix, ventes), puis liez l&apos;offre fournisseur. Le score se calcule automatiquement. <div className="mt-4"><Link href="/research/new" className="btn-primary">Démarrer une recherche</Link></div></>}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((p) => <ProductCard key={p.id} p={{ ...p, supplier: pickOffer(p.offers)?.supplier ?? null, linkStatus: pickOffer(p.offers)?.linkStatus ?? null, saved: p.savedBy.length > 0 }} />)}
        </div>
      )}
    </>
  );
}
