import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/contexts/auth";
import { useTranslation } from "react-i18next";
import { 
  LayoutDashboard, 
  Inbox, 
  CalendarClock, 
  HardHat, 
  Settings, 
  LogOut 
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SiHexo } from "react-icons/si";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const { t } = useTranslation();

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
      <aside className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col justify-between hidden md:flex">
        <div className="p-6">
          <Link href="/" className="flex items-center gap-3 mb-10 cursor-pointer">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center text-primary">
              <SiHexo size={18} />
            </div>
            <div>
              <h1 className="font-bold text-sidebar-foreground leading-tight tracking-tight">
                TaktKoord
              </h1>
              <p className="text-[10px] text-primary uppercase font-bold tracking-wider">
                Operations
              </p>
            </div>
          </Link>

          <nav className="space-y-1">
            {navItems.map((item) => {
              const isActive = item.href === "/" ? location === "/" : location.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                  }`}
                >
                  <item.icon size={18} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-2 mb-2">
            <Avatar className="h-9 w-9 bg-primary text-primary-foreground">
              <AvatarFallback>{user?.name?.[0]}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium truncate">{user?.name}</span>
              <span className="text-xs text-muted-foreground truncate">
                {user?.orgName}
              </span>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 gap-3"
            onClick={() => logout()}
          >
            <LogOut size={18} />
            {t("nav.logout")}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
