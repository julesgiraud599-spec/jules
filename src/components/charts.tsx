"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area, Cell } from "recharts";

type Pt = { label: string; value: number | null };
const ICE = "#7dd3fc";
const NEG = "#f87171";
const axis = { stroke: "#52525b", fontSize: 11, tickLine: false, axisLine: false } as const;

function fmt(v: number, unit: "eur" | "count" | "pct") {
  if (unit === "eur") return v.toLocaleString("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  if (unit === "pct") return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
  return v.toLocaleString("fr-FR");
}

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: { value: number }[]; label?: string; unit: "eur" | "count" | "pct" }) {
  if (!active || !payload?.length || payload[0].value === null) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-2.5 py-1.5 text-xs shadow-xl">
      <div className="text-muted">{label}</div>
      <div className="font-medium tabular-nums text-zinc-100">{fmt(payload[0].value, unit)}</div>
    </div>
  );
}

export function BarSeries({ data, unit = "eur", height = 220, signed }: { data: Pt[]; unit?: "eur" | "count" | "pct"; height?: number; signed?: boolean }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke="#1f1f23" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={12} />
          <YAxis {...axis} width={56} tickFormatter={(v) => fmt(v, unit)} allowDecimals={unit !== "count"} />
          <Tooltip cursor={{ fill: "rgba(125,211,252,0.06)" }} content={<Tip unit={unit} />} />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {data.map((d, i) => <Cell key={i} fill={signed && (d.value ?? 0) < 0 ? NEG : ICE} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AreaSeries({ data, unit = "eur", height = 220 }: { data: Pt[]; unit?: "eur" | "count" | "pct"; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
          <defs><linearGradient id="ice" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={ICE} stopOpacity={0.25} /><stop offset="100%" stopColor={ICE} stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#1f1f23" />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={12} />
          <YAxis {...axis} width={56} tickFormatter={(v) => fmt(v, unit)} />
          <Tooltip cursor={{ stroke: "#52525b", strokeDasharray: "3 3" }} content={<Tip unit={unit} />} />
          <Area type="monotone" connectNulls={false} isAnimationActive={false} dataKey="value" stroke={ICE} strokeWidth={2} fill="url(#ice)" activeDot={{ r: 4, stroke: "#111113", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
