import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { hubApi } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';
import { Shield, Briefcase, Hammer } from 'lucide-react';

const roleConfig = {
  ADMIN: { label: 'Admin', color: 'bg-primary text-primary-foreground', icon: Shield },
  AG: { label: 'AG', color: 'bg-blue-500 text-white', icon: Briefcase },
  AN: { label: 'AN', color: 'bg-emerald-500 text-white', icon: Hammer },
};

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  // Redirect non-admins
  useEffect(() => {
    if (user && user.hubRole !== 'ADMIN') {
      setLocation('/');
    }
  }, [user, setLocation]);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: hubApi.admin.users,
    enabled: user?.hubRole === 'ADMIN',
  });

  if (user?.hubRole !== 'ADMIN') {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Alle Nutzer</h1>
        <p className="text-muted-foreground mt-1">Übersicht aller registrierten Hub-Nutzer</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Nutzer ({users.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Noch keine Nutzer registriert
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>E-Mail</TableHead>
                    <TableHead>Rolle</TableHead>
                    <TableHead className="hidden md:table-cell">Organisation</TableHead>
                    <TableHead className="text-right">Registriert am</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map(u => {
                    const config = roleConfig[u.hubRole];
                    const Icon = config.icon;
                    return (
                      <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                        <TableCell className="font-medium">{u.name}</TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={`${config.color} gap-1.5`}>
                            <Icon size={12} />
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          {u.orgName ? (
                            <div className="flex flex-col">
                              <span className="font-medium">{u.orgName}</span>
                              {u.orgType && (
                                <span className="text-xs text-muted-foreground">({u.orgType})</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {format(new Date(u.createdAt), 'dd.MM.yyyy', { locale: de })}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
