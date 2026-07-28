import React, { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useAuth } from '@/contexts/auth-context';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Briefcase,
  Inbox,
  Users,
  Settings,
  LogOut,
  Hexagon,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);

  const navigation = [
    { name: t('nav.dashboard'), href: '/', icon: LayoutDashboard },
    { name: t('nav.projects'), href: '/projects', icon: Briefcase },
    { name: t('nav.proposals'), href: '/proposals', icon: Inbox },
    { name: t('nav.contractors'), href: '/contractors', icon: Users },
    { name: t('nav.settings'), href: '/settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${collapsed ? 'w-14' : 'w-64'} bg-sidebar border-r border-sidebar-border flex flex-col flex-shrink-0 transition-all duration-200`}
      >
        {/* Logo + toggle */}
        <div className="h-14 flex items-center border-b border-sidebar-border flex-shrink-0 px-3 gap-2">
          {!collapsed && (
            <div className="flex items-center gap-2.5 flex-1 min-w-0 pl-1">
              <Hexagon className="w-5 h-5 text-primary fill-primary/20 flex-shrink-0" />
              <div className="min-w-0">
                <div className="font-bold text-sm text-sidebar-foreground leading-tight tracking-tight truncate">
                  TaktKoord
                </div>
                <div className="text-[9px] text-primary uppercase font-bold tracking-wider">
                  Planung
                </div>
              </div>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors flex-shrink-0 ${collapsed ? 'mx-auto' : 'ml-auto'}`}
            title={collapsed ? 'Seitenleiste öffnen' : 'Seitenleiste schließen'}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Org name */}
        {!collapsed && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-5 pt-4 pb-2">
            {user?.orgName || 'Client'}
          </div>
        )}

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-1.5 py-3' : 'px-3 pb-3'} space-y-0.5`}>
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
            return (
              <Link key={item.name} href={item.href}>
                <div
                  title={collapsed ? item.name : undefined}
                  className={`flex items-center gap-3 rounded-md text-sm font-medium transition-colors cursor-pointer
                    ${collapsed ? 'justify-center p-2' : 'px-3 py-2.5'}
                    ${isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
                    }`}
                >
                  <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
                  {!collapsed && <span className="truncate">{item.name}</span>}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className={`border-t border-sidebar-border ${collapsed ? 'p-2' : 'p-3'}`}>
          {!collapsed && (
            <div className="flex items-center gap-3 px-2 py-2 mb-1">
              <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
                {user?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-medium truncate">{user?.name}</span>
                <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
              </div>
            </div>
          )}
          <button
            onClick={logout}
            title={collapsed ? t('nav.logout') : undefined}
            className={`flex items-center gap-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors w-full text-sm
              ${collapsed ? 'justify-center p-2' : 'px-3 py-2'}`}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span>{t('nav.logout')}</span>}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <main className="flex-1 overflow-y-auto p-8 relative">
          {children}
        </main>
      </div>
    </div>
  );
}
