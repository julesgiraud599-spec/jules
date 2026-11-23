import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { dayKey, eur, num } from "@/lib/format";
import { summarize, monthKey } from "@/lib/accounting";
import { aiConfigured } from "@/lib/ai";
import { aliexpressConfigured } from "@/lib/aliexpress";
import { PageHeader, Section, Stat, ScoreBadge, Thumb, Empty } from "@/components/ui";

export default async function Dashboard() {
  const user = await requireUser();
  const startOfDay = new Date(dayKey() + "T00:00:00");
  const [detectedToday, best, savedCount, sel, sales, expenses, listings, totalProducts] = await Promise.all([
    db.product.count({ where: { userId: user.id, createdAt: { gte: startOfDay } } }),
    db.product.findMany({ where: { userId: user.id, score: { not: null } }, orderBy: { score: "desc" }, take: 5 }),
    db.savedProduct.count({ where: { userId: user.id } }),
    db.dailySelection.findUnique({ where: { userId_date: { userId: user.id, date: dayKey() } }, include: { items: { include: { product: true } } } }),
    db.sale.findMany({ where: { userId: user.id } }),
    db.expense.findMany({ where: { userId: user.id } }),
    db.vintedListing.findMany({ where: { userId: user.id }, include: { snapshots: { orderBy: { capturedAt: "asc" } } } }),
    db.product.count({ where: { userId: user.id } }),
  ]);
  const m = monthKey(new Date());
  const month = summarize(sales.filter((s) => monthKey(s.date) === m), expenses.filter((e) => monthKey(e.date) === m), user.contributionRate);
  const potential = sel?.items.reduce((a, i) => a + (i.product.grossMargin ?? 0), 0) ?? null;
  const trends = listings.map((l) => {
    const s = l.snapshots.filter((x) => x.favorites !== null);
    if (s.length < 2) return null;
    const days = (+s[s.length - 1].capturedAt - +s[0].capturedAt) / 86_400_000;
    return days >= 0.5 ? { l, perDay: ((s[s.length - 1].favorites as number) - (s[0].favorites as number)) / days } : null;
  }).filter((x): x is NonNullable<typeof x> => x !== null && x.perDay > 0).sort((a, b) => b.perDay - a.perDay).slice(0, 5);

  return (
    <>
      <PageHeader title={`Bonjour${user.name ? `, ${user.name}` : ""}`} subtitle="Vue d'ensemble de vos recherches et de votre activité." />
      {totalProducts === 0 && (
        <div className="card mb-6 border-sky-900/60 bg-gradient-to-br from-ice-soft/50 to-panel p-5">
          <h2 className="font-medium text-zinc-50">Bienvenue sur Glacier</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">Vinted ne propose pas d&apos;API publique de données. Glacier ne fait pas de scraping interdit et n&apos;invente aucune statistique. Les indicateurs viennent des annonces que vous relevez (saisie ou import), et les offres AliExpress de l&apos;API officielle Affiliés.</p>
          <div className="mt-4 flex flex-wrap gap-2"><Link href="/research/new" className="btn-primary">Créer ma première recherche</Link><Link href="/settings" className="btn-ghost">Configurer les intégrations</Link></div>
        </div>
      )}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Produits détectés aujourd'hui" value={detectedToday} hint={`${totalProducts} suivi(s) au total`} />
        <Stat label="Sélection du jour" value={sel ? `${sel.items.length} / 10` : "Non générée"} hint={<Link href="/daily" className="text-ice hover:underline">Voir</Link>} />
        <Stat label="Marge potentielle cumulée" value={eur(potential)} hint="Sélection du jour, 1 unité chacun" accent />
        <Stat label="Produits sauvegardés" value={savedCount} />
        <Stat label="CA du mois" value={eur(month.revenue)} />
        <Stat label="Bénéfice net du mois" value={eur(month.netProfit)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Meilleures opportunités" action={<Link href="/research" className="text-xs text-ice hover:underline">Tout voir</Link>}>
          {best.length === 0 ? <Empty title="Aucun produit scoré" /> : (
            <ul className="divide-y divide-line">{best.map((p) => (
              <li key={p.id}><Link href={`/products/${p.id}`} className="flex items-center gap-3 py-2.5 hover:text-ice">
                <Thumb src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1"><div className="truncate text-sm">{p.name}</div><div className="text-xs text-muted">{p.category} · marge {eur(p.grossMargin)}</div></div>
                <ScoreBadge score={p.score} />
              </Link></li>))}</ul>
          )}
        </Section>
        <Section title="Dernières tendances (favoris en hausse)" action={<Link href="/trends" className="text-xs text-ice hover:underline">Tendances</Link>}>
          {trends.length === 0 ? <p className="text-sm text-muted">Mettez à jour les favoris de vos annonces suivies (au moins 12 h d&apos;écart) pour voir la demande évoluer.</p> : (
            <ul className="divide-y divide-line">{trends.map(({ l, perDay }) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5 text-sm"><a href={l.url} target="_blank" rel="noopener noreferrer" className="truncate hover:text-ice">{l.title}</a><span className="shrink-0 tabular-nums text-emerald-300">+{perDay.toFixed(1)} fav./j · {num(l.favorites)}</span></li>))}</ul>
          )}
        </Section>
        <Section title="État des intégrations" className="lg:col-span-2">
          <ul className="grid gap-3 text-sm sm:grid-cols-3">
            {[["API AliExpress Affiliés", aliexpressConfigured()], ["IA (Claude)", aiConfigured()], ["Webhook de notification", Boolean(user.webhookUrl)]].map(([k, ok]) => (
              <li key={String(k)} className="flex items-center gap-2 rounded-lg border border-line p-3"><span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-400" : "bg-zinc-600"}`} />{k}<span className="ml-auto text-xs text-muted">{ok ? "Actif" : "Non configuré"}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Dernière sélection automatique : {user.lastDailyRunAt ? user.lastDailyRunAt.toLocaleString("fr-FR") : "jamais"}.</p>
        </Section>
      </div>
    </>
  );
}
