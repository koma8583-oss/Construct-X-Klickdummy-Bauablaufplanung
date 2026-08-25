import { useQuery } from '@tanstack/react-query';
import { useRoute, useLocation } from 'wouter';
import { hubApi, type HubMessage } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ArrowLeft, Clock, CheckCircle2, XCircle, Ban, AlertCircle, Building2, Calendar, type LucideIcon } from 'lucide-react';
import type React from 'react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';

const messageTypeConfig: Record<string, { label: string; color: string; dotColor: string; icon: React.ComponentType<{ size?: number }> }> = {
  DELEGATION_CREATED:      { label: 'Vergabe erstellt',           color: 'bg-blue-500 text-white',    dotColor: 'bg-blue-500',    icon: Clock },
  DELEGATION_CONFIRMED:    { label: 'Bestätigt',                   color: 'bg-emerald-500 text-white', dotColor: 'bg-emerald-500', icon: CheckCircle2 },
  DELEGATION_REJECTED:     { label: 'Abgelehnt',                   color: 'bg-red-500 text-white',     dotColor: 'bg-red-500',     icon: XCircle },
  DELEGATION_ALTERNATIVE:  { label: 'Gegenvorschlag',              color: 'bg-amber-500 text-white',   dotColor: 'bg-amber-500',   icon: AlertCircle },
  DELEGATION_CANCELLED:    { label: 'Storniert',                   color: 'bg-gray-500 text-white',    dotColor: 'bg-gray-500',    icon: Ban },
  AG_ACCEPTED_ALTERNATIVE: { label: 'Gegenvorschlag angenommen',   color: 'bg-emerald-500 text-white', dotColor: 'bg-emerald-500', icon: CheckCircle2 },
  AG_REJECTED_ALTERNATIVE: { label: 'Gegenvorschlag abgelehnt',    color: 'bg-red-500 text-white',     dotColor: 'bg-red-500',     icon: XCircle },
  TAKT_REQUEST_EXPIRED:    { label: 'Anfrage abgelaufen',           color: 'bg-gray-400 text-white',    dotColor: 'bg-gray-400',    icon: Ban },
  TAKT_REQUEST_REMINDER:   { label: 'Erinnerung',                   color: 'bg-orange-400 text-white',  dotColor: 'bg-orange-400',  icon: AlertCircle },
};

export default function MessageDetailPage() {
  const [, params] = useRoute('/messages/:delegationId');
  const [, setLocation] = useLocation();
  const delegationId = params?.delegationId;

  const { data: timeline, isLoading, error } = useQuery({
    queryKey: ['hub-timeline', delegationId],
    queryFn: () => hubApi.messages.timeline(delegationId!),
    enabled: !!delegationId,
  });

  if (!delegationId) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Keine Delegation-ID angegeben</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-64" />
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !timeline) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => setLocation('/messages')} data-testid="button-back">
          <ArrowLeft size={16} className="mr-2" />
          Zurück
        </Button>
        <Card>
          <CardContent className="py-12 text-center text-destructive">
            Fehler beim Laden der Timeline
          </CardContent>
        </Card>
      </div>
    );
  }

  const { delegation, timeline: timelineMessages } = timeline;

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => setLocation('/messages')} data-testid="button-back">
        <ArrowLeft size={16} className="mr-2" />
        Zurück
      </Button>

      {/* Header card */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1">
              <CardTitle className="text-2xl">
                {delegation.takt?.taktBezeichnung || 'Leistung'} – {delegation.takt?.gewerk || 'Gewerk'}
              </CardTitle>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Building2 size={14} />
                  {delegation.project?.name || delegation.projectId}
                </div>
                {delegation.takt?.zone && (
                  <div className="flex items-center gap-1.5">
                    Zone: {delegation.takt.zone}
                  </div>
                )}
              </div>
            </div>
            <Badge variant="secondary" className="text-sm">
              {delegation.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Auftraggeber → Nachunternehmer
              </div>
              <div className="text-sm font-medium">
                {delegation.agOrgId} → {delegation.anOrgId}
              </div>
            </div>
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Angefragter Zeitraum
              </div>
              <div className="text-sm font-medium flex items-center gap-1.5">
                <Calendar size={14} className="text-muted-foreground" />
                {format(new Date(delegation.requestedStart), 'dd.MM.yyyy', { locale: de })} –{' '}
                {format(new Date(delegation.requestedEnd), 'dd.MM.yyyy', { locale: de })}
              </div>
            </div>
          </div>
          {delegation.message && (
            <div className="pt-2">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                Nachricht
              </div>
              <div className="text-sm bg-muted/50 p-3 rounded-md">
                {delegation.message}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {timelineMessages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Noch keine Timeline-Einträge vorhanden
            </div>
          ) : (
            <div className="space-y-6">
              {timelineMessages.map((message, index) => {
                const config = messageTypeConfig[message.type];
                const Icon = config.icon;
                const isLast = index === timelineMessages.length - 1;

                return (
                  <div key={message.id} className="flex gap-4" data-testid={`timeline-item-${message.id}`}>
                    {/* Left: dot + line */}
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full ${config.dotColor} flex-shrink-0`} />
                      {!isLast && <div className="flex-1 w-0.5 bg-border mt-2" />}
                    </div>

                    {/* Right: content */}
                    <div className="flex-1 pb-6">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <Badge variant="secondary" className={`${config.color} gap-1.5`}>
                          <Icon size={12} />
                          {config.label}
                        </Badge>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {format(new Date(message.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground mb-2">
                        Von <span className="font-medium text-foreground">{message.senderOrg?.name || message.senderOrgId}</span> an{' '}
                        <span className="font-medium text-foreground">{message.recipientOrg?.name || message.recipientOrgId}</span>
                      </div>
                      {message.payload && Object.keys(message.payload).length > 0 && (
                        <div className="bg-muted/50 rounded-md p-3 text-xs font-mono space-y-1">
                          {Object.entries(message.payload).map(([key, value]) => (
                            <div key={key} className="flex gap-2">
                              <span className="text-muted-foreground">{key}:</span>
                              <span className="text-foreground">
                                {typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)
                                  ? format(new Date(value), 'dd.MM.yyyy', { locale: de })
                                  : JSON.stringify(value)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
