import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, MessageSquare, Users, LogOut, Menu, X, Radio } from 'lucide-react';
import { useAuth } from '@/contexts/auth';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems = [
    { href: '/', label: 'Dashboard', icon: LayoutDashboard },
    { href: '/messages', label: 'Nachrichten', icon: MessageSquare },
  ];

  const adminNavItems = user?.hubRole === 'ADMIN' ? [
    { href: '/admin/users', label: 'Alle Nutzer', icon: Users },
  ] : [];

  const initials = user?.name
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  const handleLogout = async () => {
    await logout();
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  return (
    <div className="flex min-h-[100dvh] bg-background">
      {/* Mobile menu button */}
      <button
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="sm:hidden fixed top-4 left-4 z-50 p-2 bg-sidebar text-sidebar-foreground rounded-md"
        data-testid="button-mobile-menu"
      >
        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform sm:translate-x-0',
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Branding */}
        <div className="p-6 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
              <Radio className="text-primary-foreground" size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-sm font-bold text-sidebar-foreground leading-tight">
                Construct-X Takt Coordination
              </div>
              <div className="text-xs text-sidebar-foreground/60 font-medium tracking-wider mt-0.5">
                HUB
              </div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(item => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                )}
                onClick={closeMobileMenu}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon size={18} />
                {item.label}
              </Link>
            );
          })}

          {adminNavItems.length > 0 && (
            <>
              <Separator className="my-4 bg-sidebar-border" />
              <div className="px-3 py-2 text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider">
                Admin
              </div>
              {adminNavItems.map(item => {
                const isActive = location === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                    )}
                    onClick={closeMobileMenu}
                    data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <item.icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </>
          )}
        </nav>

        {/* User info + logout */}
        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3 mb-3">
            <Avatar className="w-9 h-9">
              <AvatarFallback className="bg-primary text-primary-foreground text-sm font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-sidebar-foreground truncate">
                {user?.name}
              </div>
              {user?.orgName && (
                <div className="text-xs text-sidebar-foreground/60 truncate">
                  {user.orgName}
                </div>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut size={16} />
            Abmelden
          </Button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="sm:hidden fixed inset-0 bg-black/50 z-30"
          onClick={closeMobileMenu}
        />
      )}

      {/* Main content */}
      <main className="flex-1 sm:ml-64 overflow-x-hidden">
        <div className="container max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
