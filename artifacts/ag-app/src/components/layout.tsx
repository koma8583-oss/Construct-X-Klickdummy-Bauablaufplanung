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
  Menu,
  X,
} from 'lucide-react';

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = [
    { name: t('nav.dashboard'), href: '/', icon: LayoutDashboard },
    { name: t('nav.projects'), href: '/projects', icon: Briefcase },
    { name: t('nav.proposals'), href: '/proposals', icon: Inbox },
    { name: t('nav.contractors'), href: '/contractors', icon: Users },
    { name: t('nav.settings'), href: '/settings', icon: Settings },
  ];

  const closeMobile = () => setMobileOpen(false);

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <div
        className={[
          'w-64', collapsed ? 'sm:w-14' : '',
          'bg-sidebar border-r border-sidebar-border flex flex-col flex-shrink-0',
          'fixed inset-y-0 left-0 z-50 sm:relative sm:z-auto sm:translate-x-0',
          'transition-all duration-200',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        {/* Logo row */}
        <div className="h-14 flex items-center border-b border-sidebar-border flex-shrink-0 px-3 gap-2">
          <div className={`flex items-center gap-2.5 flex-1 min-w-0 pl-1 ${collapsed ? 'sm:hidden' : ''}`}>
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
            className={`hidden sm:flex items-center justify-center w-8 h-8 rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors flex-shrink-0 ${collapsed ? 'mx-auto' : 'ml-auto'}`}
            title={collapsed ? 'Seitenleiste öffnen' : 'Seitenleiste schließen'}
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Org label */}
        <div className={`text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-5 pt-4 pb-2 ${collapsed ? 'sm:hidden' : ''}`}>
          {user?.orgName || 'Client'}
        </div>

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto px-3 pb-3 ${collapsed ? 'sm:px-1.5 sm:py-3' : ''} space-y-0.5`}>
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
            return (
              <Link key={item.name} href={item.href} onClick={closeMobile}>
                <div
                  title={collapsed ? item.name : undefined}
                  className={[
                    'flex items-center gap-3 rounded-md text-sm font-medium transition-colors cursor-pointer',
                    'px-3 py-2.5', collapsed ? 'sm:justify-center sm:p-2' : '',
                    isActive
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
                  ].join(' ')}
                >
                  <item.icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-primary' : ''}`} />
                  <span className={`truncate ${collapsed ? 'sm:hidden' : ''}`}>{item.name}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className={`border-t border-sidebar-border p-3 ${collapsed ? 'sm:p-2' : ''}`}>
          <div className={`flex items-center gap-3 px-2 py-2 mb-1 ${collapsed ? 'sm:hidden' : ''}`}>
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0">
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium truncate">{user?.name}</span>
              <span className="text-xs text-muted-foreground truncate">{user?.email}</span>
            </div>
          </div>
          <button
            onClick={logout}
            title={collapsed ? t('nav.logout') : undefined}
            className={[
              'flex items-center gap-2 rounded-md text-muted-foreground hover:text-foreground',
              'hover:bg-sidebar-accent/50 transition-colors w-full text-sm px-3 py-2',
              collapsed ? 'sm:justify-center sm:p-2' : '',
            ].join(' ')}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" />
            <span className={collapsed ? 'sm:hidden' : ''}>{t('nav.logout')}</span>
          </button>
        </div>
      </div>

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
            <span className="font-bold text-sm text-sidebar-foreground">TaktKoord</span>
            <span className="text-[9px] text-primary uppercase font-bold tracking-wider">Planung</span>
          </div>
        </div>
        <main className="flex-1 overflow-y-auto p-4 sm:p-8 relative">
          {children}
        </main>
      </div>
    </div>
  );
}
