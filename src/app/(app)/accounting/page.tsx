import Link from "next/link";
import clsx from "clsx";
import { Download, Trash2 } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { eur, pct, dayKey, dateFr } from "@/lib/format";
import { saleNet } from "@/lib/scoring";
import { summarize, bucket, lastDays, lastMonths, monthKey } from "@/lib/accounting";
import { PageHeader, Section, Stat, Empty } from "@/components/ui";
import { BarSeries, AreaSeries } from "@/components/charts";
import { ActionForm, Submit } from "@/components/action-form";
import { addSaleAction, addExpenseAction, addInventoryAction, deleteSaleAction, deleteExpenseAction, deleteInventoryAction, adjustInventoryAction, refundSaleAction } from "@/app/actions";

const TABS = [["overview", "Vue d'ensemble"], ["sales", "Ventes"], ["expenses", "Dépenses"], ["stock", "Stock"], ["calendar", "Calendrier"]] as const;
const EXP_CAT: Record<string, string> = { STOCK: "Achat de stock", EMBALLAGE: "Emballage", ENVOI: "Envoi", ABONNEMENT: "Abonnement / outil", AUTRE: "Autre" };

export default async function Accounting({ searchParams }: { searchParams: Promise<{ tab?: string; month?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "overview";
  const user = await requireUser();
  const [sales, expenses, inventory] = await Promise.all([
    db.sale.findMany({ where: { userId: user.id }, orderBy: { date: "desc" } }),
    db.expense.findMany({ where: { userId: user.id }, orderBy: { date: "desc" } }),
    db.inventoryItem.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } }),
  ]);
  const rate = user.contributionRate;
  const all = summarize(sales, expenses, rate);
  const thisMonth = monthKey(new Date());
  const month = summarize(sales.filter((s) => monthKey(s.date) === thisMonth), expenses.filter((e) => monthKey(e.date) === thisMonth), rate);
  const today = new Date().toISOString().slice(0, 10);

  const days = lastDays(30), months = lastMonths(12);
  const dayLabel = (k: string) => new Date(k + "T12:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const monthLabel = (k: string) => new Date(k + "-15").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" });
  const revDay = bucket(sales, dayKey, days, (r) => r.reduce((a, s) => a + saleNet(s, rate).revenue, 0));
  const revMonth = bucket(sales, monthKey, months, (r) => r.reduce((a, s) => a + saleNet(s, rate).revenue, 0));
  const profitMonth = months.map((k) => ({ key: k, value: summarize(sales.filter((s) => monthKey(s.date) === k), expenses.filter((e) => monthKey(e.date) === k), rate).netProfit }));
  const expMonth = bucket(expenses, monthKey, months, (r) => r.reduce((a, e) => a + e.amount, 0));
  const countMonth = bucket(sales, monthKey, months, (r) => r.filter((s) => !s.refunded).reduce((a, s) => a + s.quantity, 0));
  const marginMonth = months.map((k) => ({ key: k, value: summarize(sales.filter((s) => monthKey(s.date) === k), [], rate).avgMarginPct }));
  let cum = 0;
  const cumProfit = profitMonth.map((p) => ({ key: p.key, value: (cum += p.value) }));
  const stockValue = inventory.reduce((a, i) => a + i.quantity * i.unitCost, 0);

  return (
    <>
      <PageHeader title="Comptabilité" subtitle={`Suivi de votre activité. Cotisations estimées au taux de ${rate} % (modifiable dans Paramètres).`}>
        <a href="/api/export?type=all&format=xlsx" className="btn-ghost"><Download size={15} />Excel</a>
        <a href="/api/export?type=sales&format=csv" className="btn-ghost"><Download size={15} />CSV ventes</a>
        <a href="/api/export?type=expenses&format=csv" className="btn-ghost"><Download size={15} />CSV dépenses</a>
      </PageHeader>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map(([k, label]) => <Link key={k} href={`/accounting?tab=${k}`} className={clsx("whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors", tab === k ? "border-ice text-ice" : "border-transparent text-muted hover:text-zinc-200")}>{label}</Link>)}
      </div>

      {tab === "overview" && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="CA du mois" value={eur(month.revenue)} hint={`Total : ${eur(all.revenue)}`} />
            <Stat label="Bénéfice net du mois" value={<span className={month.netProfit < 0 ? "text-red-300" : ""}>{eur(month.netProfit)}</span>} accent hint={`Total : ${eur(all.netProfit)}`} />
            <Stat label="Ventes du mois" value={month.salesCount} hint={`Total : ${all.salesCount}`} />
            <Stat label="Marge nette moyenne" value={pct(all.avgMarginPct)} hint={`Remboursé : ${eur(all.refunds)}`} />
            <Stat label="Dépenses du mois" value={eur(summarize([], expenses.filter((e) => monthKey(e.date) === thisMonth), rate).expensesTotal)} hint={`Total : ${eur(all.expensesTotal)}`} />
            <Stat label="Cotisations estimées (mois)" value={eur(month.contributions)} />
            <Stat label="Valeur du stock" value={eur(stockValue)} hint={`${inventory.reduce((a, i) => a + i.quantity, 0)} unité(s)`} />
            <Stat label="Coût des ventes (total)" value={eur(all.costs)} />
          </div>
          {sales.length === 0 && expenses.length === 0 ? <Empty title="Aucune donnée comptable">Enregistrez votre première vente ou dépense dans les onglets ci-dessus. Les graphiques apparaîtront ici.</Empty> : (
            <div className="grid gap-6 lg:grid-cols-2">
              <Section title="Chiffre d'affaires journalier (30 jours)"><BarSeries data={revDay.map((d) => ({ label: dayLabel(d.key), value: d.value }))} /></Section>
              <Section title="Chiffre d'affaires mensuel"><BarSeries data={revMonth.map((d) => ({ label: monthLabel(d.key), value: d.value }))} /></Section>
              <Section title="Bénéfice net mensuel"><BarSeries signed data={profitMonth.map((d) => ({ label: monthLabel(d.key), value: d.value }))} /></Section>
              <Section title="Évolution du bénéfice cumulé"><AreaSeries data={cumProfit.map((d) => ({ label: monthLabel(d.key), value: Math.round(d.value * 100) / 100 }))} /></Section>
              <Section title="Dépenses mensuelles"><BarSeries data={expMonth.map((d) => ({ label: monthLabel(d.key), value: d.value }))} /></Section>
              <Section title="Nombre de ventes par mois"><BarSeries unit="count" data={countMonth.map((d) => ({ label: monthLabel(d.key), value: d.value }))} /></Section>
              <Section title="Marge nette moyenne par mois (mois sans vente : non affiché)" className="lg:col-span-2"><AreaSeries unit="pct" data={marginMonth.map((d) => ({ label: monthLabel(d.key), value: d.value }))} /></Section>
            </div>
          )}
        </>
      )}

      {tab === "sales" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Section title="Ajouter une vente">
            <ActionForm action={addSaleAction} resetOnSuccess className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="label">Article *</label><input name="title" required className="input" /></div>
              <div><label className="label">Date</label><input name="date" type="date" defaultValue={today} className="input" /></div>
              <div><label className="label">Quantité</label><input name="quantity" type="number" min="1" defaultValue={1} className="input" /></div>
              <div className="col-span-2"><label className="label">Prélever du stock</label><select name="inventoryItemId" className="input"><option value="">Non</option>{inventory.filter((i) => i.quantity > 0).map((i) => <option key={i.id} value={i.id}>{i.name} ({i.quantity} dispo, {eur(i.unitCost)}/u)</option>)}</select></div>
              <div><label className="label">Prix de vente unitaire (€) *</label><input name="salePrice" type="number" step="0.01" min="0" required className="input" /></div>
              <div><label className="label">Prix d&apos;achat unitaire (€)</label><input name="purchaseCost" type="number" step="0.01" min="0" className="input" placeholder="Auto si stock" /></div>
              <div><label className="label">Frais de port vendeur (€)</label><input name="shippingCost" type="number" step="0.01" min="0" className="input" /></div>
              <div><label className="label">Autres frais (€)</label><input name="fees" type="number" step="0.01" min="0" className="input" /></div>
              <div><label className="label">Emballage (€)</label><input name="packaging" type="number" step="0.01" min="0" defaultValue={user.packagingCost} className="input" /></div>
              <div className="col-span-2"><label className="label">Notes</label><input name="notes" className="input" /></div>
              <div className="col-span-2"><Submit>Enregistrer la vente</Submit></div>
            </ActionForm>
          </Section>
          <Section title={`Ventes (${sales.length})`} className="xl:col-span-2">
            {sales.length === 0 ? <Empty title="Aucune vente enregistrée" /> : (
              <div className="-mx-4 overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead><tr><th className="th">Date</th><th className="th">Article</th><th className="th text-right">Vente</th><th className="th text-right">Coûts</th><th className="th text-right">Cotis.</th><th className="th text-right">Net</th><th className="th">Remboursement</th><th className="th" /></tr></thead>
                  <tbody>{sales.map((s) => { const n = saleNet(s, rate); return (
                    <tr key={s.id} className={s.refunded ? "opacity-70" : ""}>
                      <td className="td whitespace-nowrap text-muted">{dateFr(s.date)}</td>
                      <td className="td">{s.title}{s.quantity > 1 && <span className="text-muted"> ×{s.quantity}</span>}</td>
                      <td className="td text-right tabular-nums">{eur(s.salePrice * s.quantity)}</td>
                      <td className="td text-right tabular-nums text-muted">{eur(n.costs)}</td>
                      <td className="td text-right tabular-nums text-muted">{eur(n.contributions)}</td>
                      <td className={`td text-right tabular-nums ${n.net >= 0 ? "text-emerald-300" : "text-red-300"}`}>{eur(n.net)}</td>
                      <td className="td">{s.refunded ? <span className="badge border-amber-800 text-amber-300">Remboursé {eur(s.refundAmount)}</span> : (
                        <details><summary className="cursor-pointer text-xs text-muted hover:text-zinc-200">Rembourser</summary>
                          <ActionForm action={refundSaleAction} className="mt-2 space-y-2">
                            <input type="hidden" name="saleId" value={s.id} />
                            <input name="refundAmount" type="number" step="0.01" min="0" defaultValue={s.salePrice * s.quantity} className="input" />
                            {s.inventoryItemId && <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="restock" /> Remettre en stock</label>}
                            <Submit variant="ghost" className="btn-sm">Valider</Submit>
                          </ActionForm>
                        </details>)}
                      </td>
                      <td className="td text-right"><form action={deleteSaleAction}><input type="hidden" name="saleId" value={s.id} /><button aria-label="Supprimer" className="text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button></form></td>
                    </tr>); })}</tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === "expenses" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Section title="Ajouter une dépense">
            <ActionForm action={addExpenseAction} resetOnSuccess className="space-y-3">
              <div><label className="label">Intitulé *</label><input name="label" required className="input" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Date</label><input name="date" type="date" defaultValue={today} className="input" /></div>
                <div><label className="label">Montant (€) *</label><input name="amount" type="number" step="0.01" min="0" required className="input" /></div>
              </div>
              <div><label className="label">Catégorie</label><select name="category" className="input">{Object.entries(EXP_CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <p className="text-[11px] text-zinc-500">Les achats de stock comptent dans la trésorerie, mais pas deux fois dans le bénéfice : leur coût est déduit au moment de chaque vente.</p>
              <Submit>Enregistrer</Submit>
            </ActionForm>
          </Section>
          <Section title={`Dépenses (${expenses.length})`} className="xl:col-span-2">
            {expenses.length === 0 ? <Empty title="Aucune dépense" /> : (
              <div className="-mx-4 overflow-x-auto"><table className="w-full min-w-[480px]">
                <thead><tr><th className="th">Date</th><th className="th">Intitulé</th><th className="th">Catégorie</th><th className="th text-right">Montant</th><th className="th" /></tr></thead>
                <tbody>{expenses.map((e) => <tr key={e.id}><td className="td text-muted">{dateFr(e.date)}</td><td className="td">{e.label}</td><td className="td text-muted">{EXP_CAT[e.category] ?? e.category}</td><td className="td text-right tabular-nums">{eur(e.amount)}</td>
                  <td className="td text-right"><form action={deleteExpenseAction}><input type="hidden" name="expenseId" value={e.id} /><button aria-label="Supprimer" className="text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button></form></td></tr>)}</tbody>
              </table></div>
            )}
          </Section>
        </div>
      )}

      {tab === "stock" && (
        <div className="grid gap-6 xl:grid-cols-3">
          <Section title="Ajouter au stock">
            <ActionForm action={addInventoryAction} resetOnSuccess className="space-y-3">
              <div><label className="label">Article *</label><input name="name" required className="input" /></div>
              <div><label className="label">Fournisseur</label><select name="supplier" className="input"><option value="">—</option><option>AliExpress</option><option>Temu</option><option>SHEIN</option></select></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Quantité *</label><input name="quantity" type="number" min="0" required className="input" /></div>
                <div><label className="label">Coût unitaire (€) *</label><input name="unitCost" type="number" step="0.01" min="0" required className="input" /></div>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" name="asExpense" defaultChecked /> Enregistrer aussi l&apos;achat comme dépense</label>
              <Submit>Ajouter</Submit>
            </ActionForm>
          </Section>
          <Section title={`Stock (${eur(stockValue)})`} className="xl:col-span-2">
            {inventory.length === 0 ? <Empty title="Stock vide" /> : (
              <div className="-mx-4 overflow-x-auto"><table className="w-full min-w-[520px]">
                <thead><tr><th className="th">Article</th><th className="th">Fournisseur</th><th className="th text-right">Qté</th><th className="th text-right">Coût unit.</th><th className="th text-right">Valeur</th><th className="th">Ajuster</th><th className="th" /></tr></thead>
                <tbody>{inventory.map((i) => <tr key={i.id}>
                  <td className="td">{i.name}{i.quantity === 0 && <span className="ml-2 badge border-amber-800 text-amber-300">Rupture</span>}</td><td className="td text-muted">{i.supplier ?? "—"}</td>
                  <td className="td text-right tabular-nums">{i.quantity}</td><td className="td text-right tabular-nums">{eur(i.unitCost)}</td><td className="td text-right tabular-nums">{eur(i.quantity * i.unitCost)}</td>
                  <td className="td"><div className="flex gap-1">{[-1, 1, 10].map((d) => <form key={d} action={adjustInventoryAction}><input type="hidden" name="itemId" value={i.id} /><input type="hidden" name="delta" value={d} /><button className="btn-ghost btn-sm px-2">{d > 0 ? `+${d}` : d}</button></form>)}</div></td>
                  <td className="td text-right"><form action={deleteInventoryAction}><input type="hidden" name="itemId" value={i.id} /><button aria-label="Supprimer" className="text-zinc-600 hover:text-red-400"><Trash2 size={14} /></button></form></td>
                </tr>)}</tbody>
              </table></div>
            )}
          </Section>
        </div>
      )}

      {tab === "calendar" && <CalendarView month={sp.month} sales={sales} expenses={expenses} rate={rate} />}
    </>
  );
}

function CalendarView({ month, sales, expenses, rate }: { month?: string; sales: (Parameters<typeof summarize>[0][number] & { id: string; title: string })[]; expenses: (Parameters<typeof summarize>[1][number] & { id: string; label: string })[]; rate: number }) {
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : monthKey(new Date());
  const [y, mo] = m.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const daysIn = new Date(y, mo, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const prev = monthKey(new Date(y, mo - 2, 15)), next = monthKey(new Date(y, mo, 15));
  const cells = Array.from({ length: offset + daysIn }, (_, i) => (i < offset ? null : i - offset + 1));
  const ms = summarize(sales.filter((s) => monthKey(s.date) === m), expenses.filter((e) => monthKey(e.date) === m), rate);
  return (
    <Section title={first.toLocaleDateString("fr-FR", { month: "long", year: "numeric" })} action={<div className="flex gap-2"><Link className="btn-ghost btn-sm" href={`/accounting?tab=calendar&month=${prev}`}>←</Link><Link className="btn-ghost btn-sm" href={`/accounting?tab=calendar&month=${next}`}>→</Link></div>}>
      <div className="mb-4 flex flex-wrap gap-4 text-sm"><span>CA <b className="tabular-nums">{eur(ms.revenue)}</b></span><span>Bénéfice net <b className="tabular-nums text-ice">{eur(ms.netProfit)}</b></span><span>Ventes <b>{ms.salesCount}</b></span><span>Dépenses <b className="tabular-nums">{eur(ms.expensesTotal)}</b></span></div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">{["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((d) => <div key={d} className="py-1">{d}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const k = `${m}-${String(d).padStart(2, "0")}`;
          const ds = sales.filter((s) => dayKey(s.date) === k), de = expenses.filter((e) => dayKey(e.date) === k);
          const sum = summarize(ds, de, rate);
          const active = ds.length > 0 || de.length > 0;
          return (
            <div key={i} title={[...ds.map((s) => `Vente : ${s.title}`), ...de.map((e) => `Dépense : ${e.label}`)].join("\n")}
              className={clsx("min-h-[64px] rounded-lg border p-1.5 text-left sm:min-h-[84px]", active ? "border-sky-900/70 bg-ice-soft/30" : "border-line bg-panel2/40", k === dayKey() && "ring-1 ring-ice/50")}>
              <div className="text-[11px] text-muted">{d}</div>
              {ds.length > 0 && <div className="mt-1 truncate text-[11px] tabular-nums text-zinc-100">{eur(sum.revenue, 0)}</div>}
              {ds.length > 0 && <div className={clsx("truncate text-[10px] tabular-nums", sum.netProfit >= 0 ? "text-emerald-300" : "text-red-300")}>{sum.netProfit >= 0 ? "+" : ""}{eur(sum.netProfit, 0)}</div>}
              {de.length > 0 && <div className="truncate text-[10px] text-amber-300/80">−{eur(sum.expensesTotal, 0)}</div>}
            </div>
          );
        })}
      </div>
    </Section>
  );
}
