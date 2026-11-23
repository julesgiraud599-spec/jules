import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader, Section, Empty, ScoreBadge } from "@/components/ui";

export default async function HistoryPage() {
  const user = await requireUser();
  const [selections, jobs] = await Promise.all([
    db.dailySelection.findMany({ where: { userId: user.id }, orderBy: { date: "desc" }, take: 60, include: { items: { orderBy: { rank: "asc" }, include: { product: { select: { id: true, name: true } } } } } }),
    db.jobRun.findMany({ where: { userId: user.id }, orderBy: { startedAt: "desc" }, take: 20 }),
  ]);
  return (
    <>
      <PageHeader title="Historique" subtitle="Sélections quotidiennes passées et journal des analyses automatiques." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {selections.length === 0 && <Empty title="Aucune sélection pour l'instant" />}
          {selections.map((s) => (
            <Section key={s.id} title={new Date(s.date + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} action={<span className="text-xs text-muted">{s.items.length} produit(s)</span>}>
              {s.items.length === 0 ? <p className="text-sm text-muted">{s.note ?? "Aucun produit sélectionné."}</p> : (
                <ol className="divide-y divide-line">
                  {s.items.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="flex items-center gap-3"><span className="w-6 text-xs text-muted">#{i.rank}</span><Link href={`/products/${i.product.id}`} className="hover:text-ice">{i.product.name}</Link></span>
                      <ScoreBadge score={i.score} />
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          ))}
        </div>
        <Section title="Journal des tâches automatiques">
          {jobs.length === 0 ? <p className="text-sm text-muted">Aucune exécution.</p> : (
            <ul className="space-y-3">
              {jobs.map((j) => (
                <li key={j.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className={`badge ${j.status === "SUCCESS" ? "border-emerald-800 text-emerald-300" : j.status === "ERROR" ? "border-red-900 text-red-300" : "border-amber-800 text-amber-300"}`}>{{ SUCCESS: "Succès", ERROR: "Erreur", PARTIAL: "Partiel", RUNNING: "En cours" }[j.status] ?? j.status}</span>
                    <span className="text-muted">{j.startedAt.toLocaleString("fr-FR")}</span>
                  </div>
                  {j.error && <p className="mt-2 text-xs text-red-300">{j.error}</p>}
                  {j.log && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">{j.log}</pre>}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
