import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { hubApi, type HubMessage, type HubMessageType } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, CheckCircle2, XCircle, Ban, AlertCircle, Copy, Check } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

const messageTypeConfig = {
  DELEGATION_CREATED: { label: 'Vergabe erstellt', color: 'bg-blue-500 text-white', icon: Clock },
  DELEGATION_CONFIRMED: { label: 'Bestätigt', color: 'bg-emerald-500 text-white', icon: CheckCircle2 },
  DELEGATION_REJECTED: { label: 'Abgelehnt', color: 'bg-red-500 text-white', icon: XCircle },
  DELEGATION_ALTERNATIVE: { label: 'Gegenvorschlag', color: 'bg-amber-500 text-white', icon: AlertCircle },
  DELEGATION_CANCELLED: { label: 'Storniert', color: 'bg-gray-500 text-white', icon: Ban },
  AG_ACCEPTED_ALTERNATIVE: { label: 'Gegenvorschlag angenommen', color: 'bg-emerald-500 text-white', icon: CheckCircle2 },
  AG_REJECTED_ALTERNATIVE: { label: 'Gegenvorschlag abgelehnt', color: 'bg-red-500 text-white', icon: XCircle },
};

export default function MessagesPage() {
  const [, setLocation] = useLocation();
  const [filterType, setFilterType] = useState<HubMessageType | 'ALL'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['hub-messages', filterType],
    queryFn: () =>
      hubApi.messages.list({
        type: filterType === 'ALL' ? undefined : filterType,
        limit: 100,
      }),
  });

  const handleRowClick = (message: HubMessage) => {
    if (message.delegationId) {
      setLocation(`/messages/${message.delegationId}`);
    }
  };

  const handleCopyId = (e: React.MouseEvent, delegationId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(delegationId);
    setCopiedId(delegationId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Nachrichten</h1>
        <p className="text-muted-foreground mt-1">Alle Vergabenachrichten im System</p>
      </div>

      {/* Filter bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <Select value={filterType} onValueChange={(v) => setFilterType(v as HubMessageType | 'ALL')}>
                <SelectTrigger data-testid="select-filter-type">
                  <SelectValue placeholder="Nachrichtentyp auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Alle Typen</SelectItem>
                  <SelectItem value="DELEGATION_CREATED">Vergabe erstellt</SelectItem>
                  <SelectItem value="DELEGATION_CONFIRMED">Bestätigt</SelectItem>
                  <SelectItem value="DELEGATION_REJECTED">Abgelehnt</SelectItem>
                  <SelectItem value="DELEGATION_ALTERNATIVE">Gegenvorschlag</SelectItem>
                  <SelectItem value="DELEGATION_CANCELLED">Storniert</SelectItem>
                  <SelectItem value="AG_ACCEPTED_ALTERNATIVE">Gegenvorschlag angenommen</SelectItem>
                  <SelectItem value="AG_REJECTED_ALTERNATIVE">Gegenvorschlag abgelehnt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Messages table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              Keine Nachrichten gefunden
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Typ</TableHead>
                    <TableHead>Von Org</TableHead>
                    <TableHead>An Org</TableHead>
                    <TableHead className="hidden lg:table-cell">Vergabe-ID</TableHead>
                    <TableHead className="text-right">Zeitpunkt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.map(message => {
                    const config = messageTypeConfig[message.type];
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
                            <span className="hidden xl:inline">{config.label}</span>
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium">
                          {message.senderOrg?.name || message.senderOrgId}
                        </TableCell>
                        <TableCell className="font-medium">
                          {message.recipientOrg?.name || message.recipientOrgId}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell">
                          {message.delegationId ? (
                            <div className="flex items-center gap-2">
                              <code className="text-xs text-muted-foreground font-mono">
                                {message.delegationId.slice(0, 16)}...
                              </code>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => handleCopyId(e, message.delegationId!)}
                                data-testid={`button-copy-${message.id}`}
                              >
                                {copiedId === message.delegationId ? (
                                  <Check size={14} className="text-emerald-500" />
                                ) : (
                                  <Copy size={14} />
                                )}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {format(new Date(message.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })}
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
