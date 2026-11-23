import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { currentUserId } from "@/lib/auth";
import { db } from "@/lib/db";
import { saleNet } from "@/lib/scoring";

export const dynamic = "force-dynamic";
type Row = Record<string, string | number | null>;

function csv(rows: Row[]) {
  if (!rows.length) return "﻿";
  const head = Object.keys(rows[0]);
  const esc = (v: unknown) => { const s = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + [head.join(";"), ...rows.map((r) => head.map((h) => esc(r[h])).join(";"))].join("\n");
}

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "sales";
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const d = (x: Date) => x.toISOString().slice(0, 10);

  const sheets: Record<string, Row[]> = {};
  if (type === "sales" || type === "all") {
    const sales = await db.sale.findMany({ where: { userId }, orderBy: { date: "asc" } });
    sheets["Ventes"] = sales.map((s) => { const n = saleNet(s, user.contributionRate); return {
      Date: d(s.date), Article: s.title, Quantité: s.quantity, "Prix de vente unitaire": s.salePrice, "Prix d'achat unitaire": s.purchaseCost,
      "Port vendeur": s.shippingCost, Frais: s.fees, Emballage: s.packaging, Remboursé: s.refunded ? "Oui" : "Non", "Montant remboursé": s.refundAmount,
      "Revenu net de remboursement": n.revenue, Coûts: n.costs, "Cotisations estimées": n.contributions, "Bénéfice net": n.net, Notes: s.notes,
    }; });
  }
  if (type === "expenses" || type === "all") {
    const ex = await db.expense.findMany({ where: { userId }, orderBy: { date: "asc" } });
    sheets["Dépenses"] = ex.map((e) => ({ Date: d(e.date), Intitulé: e.label, Catégorie: e.category, Montant: e.amount }));
  }
  if (type === "inventory" || type === "all") {
    const inv = await db.inventoryItem.findMany({ where: { userId } });
    sheets["Stock"] = inv.map((i) => ({ Article: i.name, Fournisseur: i.supplier, Quantité: i.quantity, "Coût unitaire": i.unitCost, Valeur: Math.round(i.quantity * i.unitCost * 100) / 100 }));
  }
  if (!Object.keys(sheets).length) return NextResponse.json({ error: "Type inconnu" }, { status: 400 });
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const [name, rows] = Object.entries(sheets)[0];
    return new NextResponse(csv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="glacier-${type}-${stamp}.csv"` } });
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "Glacier";
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    const head = rows.length ? Object.keys(rows[0]) : ["(vide)"];
    ws.columns = head.map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 2) }));
    rows.forEach((r) => ws.addRow(r));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(Buffer.from(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="glacier-comptabilite-${stamp}.xlsx"` } });
}
