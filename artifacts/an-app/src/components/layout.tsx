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
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SiHexo } from "react-icons/si";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const navItems = [
    { href: "/", icon: LayoutDashboard, label: t("nav.dashboard") },
    { href: "/requests", icon: Inbox, label: t("nav.requests") },
    { href: "/gantt", icon: CalendarClock, label: t("nav.gantt") },
    { href: "/resources", icon: HardHat, label: t("nav.resources") },
    { href: "/settings", icon: Settings, label: t("nav.settings") },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? 'w-14' : 'w-64'} border-r border-sidebar-border bg-sidebar flex flex-col transition-all duration-200 hidden md:flex flex-shrink-0`}
      >
        {/* Header */}
        <div className="h-14 flex items-center border-b border-sidebar-border flex-shrink-0 px-3 gap-2">
          {!collapsed && (
            <Link href="/" className="flex items-center gap-2.5 flex-1 min-w-0 pl-1 cursor-pointer">
              <div className="w-7 h-7 rounded bg-primary/20 flex items-center justify-center text-primary flex-shrink-0">
                <SiHexo size={14} />
              </div>
              <div className="min-w-0">
                <div className="font-bold text-sm text-sidebar-foreground leading-tight tracking-tight truncate">
                  TaktKoord
                </div>
                <div className="text-[9px] text-primary uppercase font-bold tracking-wider">
                  Operations
                </div>
              </div>
            </Link>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors flex-shrink-0 ${collapsed ? 'mx-auto' : 'ml-auto'}`}
            title={collapsed ? 'Seitenleiste öffnen' : 'Seitenleiste schließen'}
          >
            {collapsed
              ? <PanelLeftOpen className="w-4 h-4" />
              : <PanelLeftClose className="w-4 h-4" />
            }
          </button>
        </div>

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-1.5 py-3' : 'px-3 py-4'} space-y-0.5`}>
          {navItems.map((item) => {
            const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-md text-sm font-medium transition-colors
                  ${collapsed ? 'justify-center p-2' : 'px-3 py-2.5'}
                  ${isActive
                    ? "bg-sidebar-accent text-sidebar-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
              >
                <item.icon size={18} className="flex-shrink-0" />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={`border-t border-sidebar-border ${collapsed ? 'p-2' : 'p-3'}`}>
          {!collapsed && (
            <div className="flex items-center gap-3 px-2 py-2 mb-1">
              <Avatar className="h-8 w-8 bg-primary/20 text-primary flex-shrink-0">
                <AvatarFallback className="text-xs font-bold bg-primary/20 text-primary">
                  {user?.name?.[0]}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{user?.name}</span>
                <span className="text-xs text-muted-foreground truncate">{user?.orgName}</span>
              </div>
            </div>
          )}
          <button
            onClick={() => logout()}
            title={collapsed ? t("nav.logout") : undefined}
            className={`flex items-center gap-3 rounded-md text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors w-full text-sm
              ${collapsed ? 'justify-center p-2' : 'px-3 py-2'}`}
          >
            <LogOut size={18} className="flex-shrink-0" />
            {!collapsed && <span>{t("nav.logout")}</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
