import { useState, ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Inbox,
  CalendarClock,
  HardHat,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Hexagon,
  Menu,
  X,
  FolderOpen,
  CalendarDays,
  ShieldCheck,
  Globe,
} from "lucide-react";

interface NavItem {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  badge?: number;
}

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems: NavItem[] = [
    { href: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
    { href: "/leistungsanfragen", icon: Inbox, label: "Leistungsanfragen" },
    { href: "/gantt", icon: CalendarClock, label: "Terminübersicht" },
    { href: "/resources", icon: HardHat, label: "Ressourcen" },
    { href: "/resource-bookings", icon: CalendarDays, label: "Ressourcenbelegung" },
    { href: "/local-projects", icon: FolderOpen, label: "Interne Projekte" },
    { href: "/data-offers", icon: Globe, label: "Datenraum" },
    { href: "/settings", icon: Settings, label: t("nav.settings") },
  ];

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={[
          "w-64", collapsed ? "sm:w-14" : "",
          "border-r border-sidebar-border bg-sidebar flex flex-col flex-shrink-0",
          "fixed inset-y-0 left-0 z-50 sm:relative sm:z-auto sm:translate-x-0",
          "transition-all duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {/* Header row */}
        <div className="h-14 flex items-center border-b border-sidebar-border flex-shrink-0 px-3 gap-2">
          <div className={`flex items-center gap-2.5 flex-1 min-w-0 pl-1 ${collapsed ? "sm:hidden" : ""}`}>
            <Link href="/" className="flex items-center gap-2.5 min-w-0">
              <Hexagon className="w-5 h-5 text-primary fill-primary/20 flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-bold text-xs text-sidebar-foreground leading-tight tracking-tight truncate">
                  Construct-X Lean Construction Scheduling
                </div>
                <div className="text-[9px] text-primary uppercase font-bold tracking-wider">
                  Subcontractor
                </div>
              </div>
            </Link>
          </div>
          {/* Mobile: close */}
          <button
            onClick={closeMobile}
            className="sm:hidden ml-auto flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors flex-shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
          {/* Desktop: collapse */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`hidden sm:flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors flex-shrink-0 ${collapsed ? "mx-auto" : "ml-auto"}`}
            title={collapsed ? "Seitenleiste öffnen" : "Seitenleiste schließen"}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Org label */}
        <div className={`text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-5 pt-4 pb-2 ${collapsed ? "sm:hidden" : ""}`}>
          {user?.orgName || "Nachunternehmen"}
        </div>

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto px-3 pb-3 ${collapsed ? "sm:px-1.5 sm:py-3" : ""} space-y-0.5`}>
          {navItems.map((item) => {
            const isActive =
              item.href === "/" ? location === "/" : location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                title={collapsed ? item.label : undefined}
                className={[
                  "flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
                  "px-3 py-2.5", collapsed ? "sm:justify-center sm:p-2" : "",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                ].join(" ")}
              >
                {/* Icon — dot overlay in collapsed mode */}
                <span className="relative flex-shrink-0">
                  <item.icon className={`w-4 h-4 ${isActive ? "text-primary" : ""}`} />
                  {(item.badge ?? 0) > 0 && collapsed && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary" />
                  )}
                </span>
                {/* Label */}
                <span className={`truncate flex-1 ${collapsed ? "sm:hidden" : ""}`}>{item.label}</span>
                {/* Badge — number to the right when expanded */}
                {(item.badge ?? 0) > 0 && !collapsed && (
                  <span className="ml-auto flex-shrink-0 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold px-1 leading-none">
                    {(item.badge ?? 0) > 9 ? "9+" : item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={`border-t border-sidebar-border p-3 ${collapsed ? "p-2" : ""}`}>
          <div className={`${collapsed ? "sm:hidden" : ""}`}>
            <Link href="/settings" onClick={closeMobile}>
              <div className="flex items-center gap-3 px-2 py-2 mb-1 rounded-md hover:bg-sidebar-accent/50 cursor-pointer transition-colors">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                  {user?.name?.charAt(0).toUpperCase() ?? "U"}
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{user?.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
                </div>
              </div>
            </Link>
          </div>
          <button
            onClick={() => logout()}
            title={collapsed ? t("nav.logout") : undefined}
            className={[
              "flex items-center gap-2 rounded-md text-muted-foreground hover:text-foreground",
              "hover:bg-sidebar-accent/50 transition-colors w-full text-sm px-3 py-2",
              collapsed ? "sm:justify-center sm:p-2" : "",
            ].join(" ")}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className={collapsed ? "sm:hidden" : ""}>{t("nav.logout")}</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        {/* Mobile-only top bar */}
        <div className="h-14 flex-shrink-0 flex items-center px-4 border-b border-sidebar-border bg-sidebar sm:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/60 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="ml-3 flex items-center gap-2">
            <Hexagon className="w-4 h-4 text-primary fill-primary/20" />
            <span className="font-bold text-xs text-sidebar-foreground">Construct-X</span>
            <span className="text-[9px] text-primary uppercase font-bold tracking-wider">Subcontractor</span>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative">{children}</main>
      </div>
    </div>
  );
}
