import Link from "next/link";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { eur, pct, num, dateFr } from "@/lib/format";
import { ScoreBadge, Level, Thumb, SupplierBadge } from "./ui";
import { toggleSaveAction } from "@/app/actions";

export type CardProduct = {
  id: string; name: string; category: string; imageUrl: string | null; score: number | null; scoreConfidence: number | null;
  purchasePrice: number | null; recommendedPrice: number | null; grossMargin: number | null; marginPct: number | null;
  totalFavorites: number | null; demandLevel: string | null; competitionLevel: string | null; createdAt: Date;
  supplier?: string | null; saved?: boolean; rank?: number;
};

export function ProductCard({ p }: { p: CardProduct }) {
  return (
    <div className="card group flex flex-col overflow-hidden transition hover:border-zinc-700 animate-fadein">
      <Link href={`/products/${p.id}`} className="relative block">
        <Thumb src={p.imageUrl} alt={p.name} className="aspect-[4/3] w-full" />
        {p.rank && <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold text-ice backdrop-blur">#{p.rank}</span>}
        <span className="absolute right-2 top-2"><ScoreBadge score={p.score} /></span>
      </Link>
      <div className="flex flex-1 flex-col p-3.5">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/products/${p.id}`} className="line-clamp-2 text-sm font-medium text-zinc-100 hover:text-ice">{p.name}</Link>
          <form action={toggleSaveAction}><input type="hidden" name="productId" value={p.id} />
            <button aria-label={p.saved ? "Retirer des favoris" : "Sauvegarder"} className={p.saved ? "text-ice" : "text-zinc-500 hover:text-zinc-200"}>{p.saved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}</button>
          </form>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">{p.category}{p.supplier !== undefined && <SupplierBadge supplier={p.supplier} />}</div>
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <dt className="text-muted">Achat</dt><dd className="text-right tabular-nums">{eur(p.purchasePrice)}</dd>
          <dt className="text-muted">Revente conseillée</dt><dd className="text-right tabular-nums">{eur(p.recommendedPrice)}</dd>
          <dt className="text-muted">Marge brute</dt><dd className="text-right tabular-nums text-emerald-300">{p.grossMargin === null ? <span className="text-muted">{eur(null)}</span> : `${eur(p.grossMargin)} · ${pct(p.marginPct)}`}</dd>
          <dt className="text-muted">Favoris observés</dt><dd className="text-right tabular-nums">{num(p.totalFavorites)}</dd>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-3 text-[11px] text-muted">
          Demande <Level value={p.demandLevel} /> · Concurrence <Level value={p.competitionLevel} inverse />
        </div>
        <div className="mt-2 text-[11px] text-zinc-600">Détecté le {dateFr(p.createdAt)}</div>
      </div>
    </div>
  );
}
