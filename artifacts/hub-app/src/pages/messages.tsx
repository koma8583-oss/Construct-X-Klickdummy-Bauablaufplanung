import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { hubApi, type HubMessage, type HubMessageType } from '@/lib/api';
import { useAuth } from '@/contexts/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, CheckCircle2, XCircle, Ban, AlertCircle, Copy, Check, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';

const messageTypeConfig: Record<HubMessageType, { label: string; color: string; icon: React.ComponentType<{ size?: number }> }> = {
  DELEGATION_CREATED:       { label: 'Vergabe erstellt',          color: 'bg-blue-500 text-white',      icon: Clock },
  DELEGATION_CONFIRMED:     { label: 'Bestätigt',                  color: 'bg-emerald-500 text-white',   icon: CheckCircle2 },
  DELEGATION_REJECTED:      { label: 'Abgelehnt',                  color: 'bg-red-500 text-white',       icon: XCircle },
  DELEGATION_ALTERNATIVE:   { label: 'Gegenvorschlag',             color: 'bg-amber-500 text-white',     icon: AlertCircle },
  DELEGATION_CANCELLED:     { label: 'Storniert',                  color: 'bg-gray-500 text-white',      icon: Ban },
  AG_ACCEPTED_ALTERNATIVE:  { label: 'Gegenvorschlag angenommen',  color: 'bg-emerald-500 text-white',   icon: CheckCircle2 },
  AG_REJECTED_ALTERNATIVE:  { label: 'Gegenvorschlag abgelehnt',   color: 'bg-red-500 text-white',       icon: XCircle },
  TAKT_REQUEST_EXPIRED:     { label: 'Anfrage abgelaufen',          color: 'bg-gray-400 text-white',      icon: Ban },
  TAKT_REQUEST_REMINDER:    { label: 'Erinnerung',                  color: 'bg-orange-400 text-white',    icon: AlertCircle },
};

export default function MessagesPage() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filterType, setFilterType] = useState<HubMessageType | 'ALL'>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<HubMessage | null>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ['hub-messages', filterType],
    queryFn: () => hubApi.messages.list({ type: filterType === 'ALL' ? undefined : filterType, limit: 100 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (messageId: string) => hubApi.messages.delete(messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hub-messages'] });
      toast({ title: 'Nachricht gelöscht' });
      setPendingDelete(null);
    },
    onError: (err: Error) => {
      toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
      setPendingDelete(null);
    },
  });

  const handleRowClick = (message: HubMessage) => {
    if (message.delegationId) setLocation(`/messages/${message.delegationId}`);
  };

  const handleCopyId = (e: React.MouseEvent, delegationId: string) => {
    e.stopPropagation();
    navigator.clipboard.writeText(delegationId);
    setCopiedId(delegationId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDeleteClick = (e: React.MouseEvent, message: HubMessage) => {
    e.stopPropagation();
    setPendingDelete(message);
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
                  <SelectItem value="TAKT_REQUEST_EXPIRED">Anfrage abgelaufen</SelectItem>
                  <SelectItem value="TAKT_REQUEST_REMINDER">Erinnerung</SelectItem>
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
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : messages.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Keine Nachrichten gefunden</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Typ</TableHead>
                    <TableHead>Von Org</TableHead>
                    <TableHead>An Org</TableHead>
                    <TableHead className="hidden lg:table-cell">Vergabe / Anfrage</TableHead>
                    <TableHead className="hidden xl:table-cell">Korrelation</TableHead>
                    <TableHead className="text-right">Zeitpunkt</TableHead>
                    {user?.hubAdmin && <TableHead className="w-10" />}
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
                                {message.delegationId.slice(0, 16)}…
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
                            <span className="text-muted-foreground">–</span>
                          )}
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          {message.correlationId ? (
                            <code className="text-xs text-muted-foreground font-mono">
                              {message.correlationId.slice(0, 12)}…
                            </code>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {format(new Date(message.createdAt), 'dd.MM.yyyy HH:mm', { locale: de })}
                        </TableCell>
                        {user?.hubAdmin && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={(e) => handleDeleteClick(e, message)}
                              data-testid={`button-delete-${message.id}`}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirm delete dialog */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Nachricht löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Diese Aktion kann nicht rückgängig gemacht werden. Die Nachricht wird dauerhaft aus dem System entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
              disabled={deleteMutation.isPending}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
