import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { eur, num } from "@/lib/format";
import { PageHeader, Section, Empty } from "@/components/ui";
import { BarSeries } from "@/components/charts";

export default async function Trends() {
  const user = await requireUser();
  const listings = await db.vintedListing.findMany({
    where: { userId: user.id },
    include: { snapshots: { orderBy: { capturedAt: "asc" } }, product: { select: { id: true, name: true, category: true } } },
  });
  if (listings.length === 0) return (
    <>
      <PageHeader title="Tendances Vinted" subtitle="Tendances calculées à partir de vos observations." />
      <Empty title="Pas encore de données">Les tendances se construisent à partir des annonces Vinted que vous suivez. Ajoutez des annonces depuis une fiche produit.</Empty>
    </>
  );

  const byCat = new Map<string, { fav: number; favKnown: number; sold: number; count: number; price: number }>();
  for (const l of listings) {
    const k = l.product?.category ?? "Non classé";
    const c = byCat.get(k) ?? { fav: 0, favKnown: 0, sold: 0, count: 0, price: 0 };
    c.count++; c.price += l.price; if (l.status === "SOLD") c.sold++;
    if (l.favorites !== null) { c.fav += l.favorites; c.favKnown++; }
    byCat.set(k, c);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1].fav - a[1].fav);

  const rising = listings.map((l) => {
    const s = l.snapshots.filter((x) => x.favorites !== null);
    if (s.length < 2) return null;
    const days = (+s[s.length - 1].capturedAt - +s[0].capturedAt) / 86_400_000;
    if (days < 0.5) return null;
    return { l, gain: (s[s.length - 1].favorites as number) - (s[0].favorites as number), perDay: ((s[s.length - 1].favorites as number) - (s[0].favorites as number)) / days };
  }).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => b.perDay - a.perDay).slice(0, 10);

  const topFav = listings.filter((l) => l.favorites !== null).sort((a, b) => (b.favorites as number) - (a.favorites as number)).slice(0, 10);
  const sold = listings.filter((l) => l.status === "SOLD").sort((a, b) => +(b.soldAt ?? 0) - +(a.soldAt ?? 0)).slice(0, 10);
  const row = (l: (typeof listings)[number], right: React.ReactNode) => (
    <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
      <div className="min-w-0"><a href={l.url} target="_blank" rel="noopener noreferrer" className="line-clamp-1 hover:text-ice">{l.title}</a>{l.product && <Link href={`/products/${l.product.id}`} className="text-[11px] text-zinc-500 hover:text-zinc-300">{l.product.name}</Link>}</div>
      <div className="shrink-0 text-right tabular-nums">{right}</div>
    </li>
  );

  return (
    <>
      <PageHeader title="Tendances Vinted" subtitle={`Calculées sur ${listings.length} annonce(s) que vous avez observée(s). Ce n'est pas un échantillon de tout Vinted.`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Favoris observés par catégorie" className="lg:col-span-2">
          <BarSeries unit="count" data={cats.map(([k, v]) => ({ label: k, value: v.fav }))} />
          <div className="-mx-4 mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead><tr><th className="th">Catégorie</th><th className="th text-right">Annonces</th><th className="th text-right">Favoris (total)</th><th className="th text-right">Ventes confirmées</th><th className="th text-right">Prix moyen</th></tr></thead>
              <tbody>{cats.map(([k, v]) => <tr key={k}><td className="td">{k}</td><td className="td text-right tabular-nums">{v.count}</td><td className="td text-right tabular-nums">{v.favKnown ? num(v.fav) : num(null)}</td><td className="td text-right tabular-nums">{v.sold}</td><td className="td text-right tabular-nums">{eur(v.price / v.count)}</td></tr>)}</tbody>
            </table>
          </div>
        </Section>
        <Section title="Demande en hausse (favoris gagnés par jour)">
          {rising.length === 0 ? <p className="text-sm text-muted">Il faut au moins deux relevés d&apos;une même annonce, à 12 h d&apos;intervalle minimum. Mettez à jour les favoris de vos annonces suivies.</p>
            : <ul className="divide-y divide-line">{rising.map((r) => row(r.l, <><span className="text-emerald-300">+{r.perDay.toFixed(1)}/j</span><div className="text-[11px] text-zinc-500">+{r.gain} au total</div></>))}</ul>}
        </Section>
        <Section title="Annonces les plus mises en favoris">
          <ul className="divide-y divide-line">{topFav.map((l) => row(l, <><span>{l.favorites} ♥</span><div className="text-[11px] text-zinc-500">{eur(l.price)}</div></>))}</ul>
        </Section>
        <Section title="Dernières ventes confirmées" className="lg:col-span-2">
          {sold.length === 0 ? <p className="text-sm text-muted">Aucune annonce suivie n&apos;a encore été marquée « Vendu ».</p>
            : <ul className="divide-y divide-line">{sold.map((l) => row(l, <><span>{eur(l.price)}</span><div className="text-[11px] text-zinc-500">{l.soldAt?.toLocaleDateString("fr-FR")}</div></>))}</ul>}
        </Section>
      </div>
    </>
  );
}
