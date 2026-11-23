"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";
import { LayoutDashboard, Search, CalendarCheck, Bookmark, TrendingUp, Calculator, History, Settings, Menu, X, Bell, LogOut } from "lucide-react";
import { logoutAction, markNotificationsReadAction } from "@/app/actions";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/research", label: "Product Research", icon: Search },
  { href: "/daily", label: "Produits du jour", icon: CalendarCheck },
  { href: "/saved", label: "Produits sauvegardés", icon: Bookmark },
  { href: "/trends", label: "Tendances Vinted", icon: TrendingUp },
  { href: "/accounting", label: "Comptabilité", icon: Calculator },
  { href: "/history", label: "Historique", icon: History },
  { href: "/settings", label: "Paramètres", icon: Settings },
];

type Notif = { id: string; title: string; body: string; link: string | null; readAt: string | null; createdAt: string };

export function Shell({ email, notifications, children }: { email: string; notifications: Notif[]; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const unread = notifications.filter((n) => !n.readAt).length;

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = path === href || (href !== "/dashboard" && path.startsWith(href)) || (href === "/research" && path.startsWith("/products"));
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={clsx("flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors", active ? "bg-ice-soft/70 text-ice" : "text-zinc-400 hover:bg-panel2 hover:text-zinc-100")}>
            <Icon size={16} strokeWidth={1.8} />{label}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <Link href="/dashboard" className="flex items-center gap-2 px-2.5 py-1">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-sky-200 to-sky-500 text-xs font-bold text-zinc-950">G</span>
      <span className="text-[15px] font-semibold tracking-tight text-zinc-50">Glacier</span>
    </Link>
  );

  const footer = (
    <div className="border-t border-line pt-3">
      <div className="truncate px-2.5 text-xs text-muted">{email}</div>
      <form action={logoutAction}><button className="mt-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-zinc-400 hover:bg-panel2 hover:text-zinc-100"><LogOut size={16} />Déconnexion</button></form>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-60">
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col gap-6 border-r border-line bg-[#0c0c0e] p-3 lg:flex">{brand}{nav}{footer}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col gap-6 border-r border-line bg-[#0c0c0e] p-3 animate-fadein">
            <div className="flex items-center justify-between">{brand}<button aria-label="Fermer" onClick={() => setOpen(false)} className="p-2 text-muted"><X size={18} /></button></div>
            {nav}{footer}
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur lg:px-8">
        <button aria-label="Menu" onClick={() => setOpen(true)} className="p-1 text-zinc-300 lg:hidden"><Menu size={20} /></button>
        <div className="lg:hidden">{brand}</div>
        <div className="hidden lg:block" />
        <div className="relative">
          <button aria-label="Notifications" onClick={() => setBell((b) => !b)} className="relative rounded-lg p-2 text-zinc-300 hover:bg-panel2">
            <Bell size={18} />
            {unread > 0 && <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ice px-1 text-[10px] font-bold text-zinc-950">{unread}</span>}
          </button>
          {bell && <div className="fixed inset-0 z-40" onClick={() => setBell(false)} />}
          {bell && (
            <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] card shadow-2xl animate-fadein">
              <div className="flex items-center justify-between border-b border-line px-3 py-2">
                <span className="text-sm font-medium">Notifications</span>
                {unread > 0 && <form action={markNotificationsReadAction}><button className="text-xs text-ice hover:underline">Tout marquer lu</button></form>}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 && <p className="p-4 text-sm text-muted">Aucune notification.</p>}
                {notifications.map((n) => (
                  <Link key={n.id} href={n.link ?? "#"} onClick={() => setBell(false)} className="block border-b border-line px-3 py-2.5 last:border-0 hover:bg-panel2">
                    <div className="flex items-center gap-2 text-sm text-zinc-100">{!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-ice" />}{n.title}</div>
                    <div className="mt-0.5 text-xs text-muted">{n.body}</div>
                    <div className="mt-1 text-[10px] text-zinc-600">{new Date(n.createdAt).toLocaleString("fr-FR")}</div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
