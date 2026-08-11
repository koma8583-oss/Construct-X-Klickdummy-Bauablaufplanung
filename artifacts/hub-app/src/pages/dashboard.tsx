import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { hubApi, type HubMessage, type HubMessageType } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Clock, CheckCircle2, XCircle, Ban, AlertCircle, RefreshCw } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { de } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';

// ── Hub report summary ────────────────────────────────────────────────────────

interface HubReportSummary {
  pendingMessages: number;
  deliveredMessages: number;
  failedMessages: number;
  retryCount: number;
}

async function fetchHubSummary(): Promise<HubReportSummary> {
  const res = await fetch('/api/reports/hub/summary', { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ── Message type labels ───────────────────────────────────────────────────────

const messageTypeConfig: Record<string, { label: string; color: string; icon: React.ComponentType<{ size?: number }> }> = {
  DELEGATION_CREATED:                  { label: 'Vergabe erstellt',          color: 'bg-blue-500 text-white',      icon: Clock },
  DELEGATION_CONFIRMED:                { label: 'Bestätigt',                  color: 'bg-emerald-500 text-white',   icon: CheckCircle2 },
  DELEGATION_REJECTED:                 { label: 'Abgelehnt',                  color: 'bg-red-500 text-white',       icon: XCircle },
  DELEGATION_ALTERNATIVE:              { label: 'Gegenvorschlag',             color: 'bg-amber-500 text-white',     icon: AlertCircle },
  DELEGATION_CANCELLED:                { label: 'Storniert',                  color: 'bg-gray-500 text-white',      icon: Ban },
  AG_ACCEPTED_ALTERNATIVE:             { label: 'Gegenvorschlag angenommen',  color: 'bg-emerald-500 text-white',   icon: CheckCircle2 },
  AG_REJECTED_ALTERNATIVE:             { label: 'Gegenvorschlag abgelehnt',   color: 'bg-red-500 text-white',       icon: XCircle },
  TAKT_REQUEST_EXPIRED:                { label: 'Anfrage abgelaufen',         color: 'bg-gray-400 text-white',      icon: Ban },
  TAKT_REQUEST_REMINDER:               { label: 'Erinnerung',                 color: 'bg-orange-400 text-white',    icon: AlertCircle },
  TAKT_REQUEST_SENT:                   { label: 'Anfrage gesendet',           color: 'bg-blue-500 text-white',      icon: Clock },
  TAKT_REQUEST_ACCEPTED:               { label: 'Akzeptiert',                 color: 'bg-emerald-500 text-white',   icon: CheckCircle2 },
  TAKT_REQUEST_ALTERNATIVES_PROPOSED:  { label: 'Alternativvorschlag',        color: 'bg-amber-500 text-white',     icon: AlertCircle },
  TAKT_REQUEST_REJECTED:               { label: 'Abgelehnt',                  color: 'bg-red-500 text-white',       icon: XCircle },
  TAKT_REQUEST_CONFIRMED:              { label: 'GU bestätigt',               color: 'bg-emerald-600 text-white',   icon: CheckCircle2 },
  TAKT_REQUEST_ALT_ACCEPTED:           { label: 'Alternative angenommen',     color: 'bg-teal-500 text-white',      icon: CheckCircle2 },
  TAKT_REQUEST_CLOSED:                 { label: 'Ohne Einigung geschlossen',  color: 'bg-gray-500 text-white',      icon: Ban },
};

const DEFAULT_CONFIG = { label: 'Nachricht', color: 'bg-gray-400 text-white', icon: Clock };

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [, setLocation] = useLocation();

  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ['hub-messages', 'dashboard'],
    queryFn: () => hubApi.messages.list({ limit: 50 }),
  });

  const { data: hubSummary, isLoading: summaryLoading } = useQuery<HubReportSummary>({
    queryKey: ['hub-report-summary'],
    queryFn: fetchHubSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const isLoading = messagesLoading || summaryLoading;

  const recentMessages = messages.slice(0, 10);

  const handleRowClick = (message: HubMessage) => {
    if (message.delegationId) {
      setLocation(`/messages/${message.delegationId}`);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Übersicht aller Vergabenachrichten</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Übersicht aller Vergabenachrichten</p>
      </div>

      {/* Stats from /api/reports/hub/summary */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ausstehend</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-pending">
              {hubSummary?.pendingMessages ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Zugestellt</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600" data-testid="stat-delivered">
              {hubSummary?.deliveredMessages ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fehlgeschlagen</CardTitle>
            <XCircle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600" data-testid="stat-failed">
              {hubSummary?.failedMessages ?? 0}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-medium text-muted-foreground">Wiederholungen</CardTitle>
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="stat-retries">
              {hubSummary?.retryCount ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent activity */}
      <Card>
        <CardHeader>
          <CardTitle>Letzte Aktivität</CardTitle>
        </CardHeader>
        <CardContent>
          {recentMessages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Noch keine Nachrichten vorhanden
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Typ</TableHead>
                  <TableHead>Von</TableHead>
                  <TableHead>An</TableHead>
                  <TableHead className="hidden md:table-cell">Delegation-ID</TableHead>
                  <TableHead className="text-right">Datum</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentMessages.map(message => {
                  const config = messageTypeConfig[message.type] ?? DEFAULT_CONFIG;
                  const Icon = config.icon;
                  return (
                    <TableRow
                      key={message.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => handleRowClick(message)}
                      data-testid={`row-message-${message.id}`}
                    >
                      <TableCell>
                        <Badge variant="secondary" className={`${config.color} gap-1.5`}>
                          <Icon size={12} />
                          <span className="hidden lg:inline">{config.label}</span>
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {message.senderOrg?.name || message.senderOrgId}
                      </TableCell>
                      <TableCell className="font-medium">
                        {message.recipientOrg?.name || message.recipientOrgId}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground hidden md:table-cell">
                        {message.delegationId ? `${message.delegationId.slice(0, 8)}...` : '-'}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        <span className="hidden lg:inline" title={format(new Date(message.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })}>
                          {formatDistanceToNow(new Date(message.createdAt), { addSuffix: true, locale: de })}
                        </span>
                        <span className="lg:hidden">
                          {format(new Date(message.createdAt), 'dd.MM', { locale: de })}
                        </span>
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
