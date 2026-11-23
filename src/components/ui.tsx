import clsx from "clsx";
import { NA, SUPPLIER_LABEL } from "@/lib/format";

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="h1">{title}</h1>{subtitle && <p className="sub mt-1">{subtitle}</p>}</div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, accent }: { label: string; value: React.ReactNode; hint?: React.ReactNode; accent?: boolean }) {
  return (
    <div className="card p-4 animate-fadein">
      <div className="text-xs text-muted">{label}</div>
      <div className={clsx("mt-1.5 text-2xl font-semibold tracking-tight tabular-nums", accent ? "text-ice" : "text-zinc-50")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Section({ title, action, children, className }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={clsx("card", className)}>
      {title && <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3"><h2 className="text-sm font-medium text-zinc-100">{title}</h2>{action}</div>}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <div className="text-sm font-medium text-zinc-200">{title}</div>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ScoreBadge({ score, confidence, size = "md" }: { score: number | null | undefined; confidence?: number | null; size?: "md" | "lg" }) {
  if (score === null || score === undefined) return <span className="badge border-line text-muted">Score {NA.toLowerCase()}</span>;
  const tone = score >= 70 ? "text-emerald-300 border-emerald-800/60 bg-emerald-950/40" : score >= 45 ? "text-ice border-sky-800/60 bg-ice-soft/60" : "text-zinc-300 border-line bg-panel2";
  if (size === "lg") {
    const r = 34, c = 2 * Math.PI * r;
    return (
      <div className="flex items-center gap-3">
        <svg width="84" height="84" viewBox="0 0 84 84" className="-rotate-90">
          <circle cx="42" cy="42" r={r} stroke="#232328" strokeWidth="7" fill="none" />
          <circle cx="42" cy="42" r={r} stroke={score >= 70 ? "#6ee7b7" : "#7dd3fc"} strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />
          <text x="42" y="42" textAnchor="middle" dominantBaseline="central" transform="rotate(90 42 42)" className="fill-zinc-50 text-[20px] font-semibold">{score}</text>
        </svg>
        <div className="text-xs text-muted"><div className="text-zinc-200">Score / 100</div>{confidence !== undefined && confidence !== null && <div>Données disponibles : {Math.round(confidence)} %</div>}</div>
      </div>
    );
  }
  return <span className={clsx("badge tabular-nums", tone)}>{score}/100</span>;
}

export function Level({ value, inverse }: { value: string | null | undefined; inverse?: boolean }) {
  if (!value) return <span className="text-muted">{NA}</span>;
  const good = inverse ? value === "Faible" : value === "Forte";
  const bad = inverse ? value === "Forte" : value === "Faible";
  return <span className={clsx("badge", good ? "border-emerald-800/60 text-emerald-300" : bad ? "border-amber-800/60 text-amber-300" : "border-sky-800/60 text-ice")}>{value}</span>;
}

export function SupplierBadge({ supplier }: { supplier: string | null | undefined }) {
  if (!supplier) return <span className="text-muted">{NA}</span>;
  const color = { ALIEXPRESS: "text-orange-300 border-orange-900/60", TEMU: "text-amber-300 border-amber-900/60", SHEIN: "text-zinc-100 border-zinc-600" }[supplier] ?? "";
  return <span className={clsx("badge", color)}>{SUPPLIER_LABEL[supplier] ?? supplier}</span>;
}

export function Thumb({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  return src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" className={clsx("object-cover bg-panel2", className)} />
    : <div className={clsx("grid place-items-center bg-panel2 text-[10px] text-muted", className)}>Pas de photo</div>;
}
