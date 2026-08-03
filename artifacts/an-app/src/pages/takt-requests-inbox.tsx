/**
 * TaktRequest Inbox — Task 7.7
 *
 * Shows TaktRequests sent to this AN-Organisation.
 * Displays deadline status (Antwortfrist, Fälligkeitsstatus, überfällig, abgelaufen),
 * whether a response is still possible, and received reminders.
 *
 * Uses /api/takt-requests?role=nu which is orgId-scoped on the server.
 * Data-sovereignty: does NOT expose snapshotPayload, resourcePlanning, internalResultPayload,
 * localProjectId, customerAlias, resourceId, employeeName, internalCost, internalPriority.
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'wouter';
import { format, differenceInHours, differenceInDays } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  useListTaktRequests,
  getListTaktRequestsQueryKey,
  type TaktRequestListItem,
  type TaktRequestStatus,
} from '@workspace/api-client-react';
import {
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Inbox,
  ChevronRight,
  Loader2,
  Ban,
  Bell,
  Timer,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Deadline helpers ──────────────────────────────────────────────────────────

type DeadlineState =
  | { kind: 'expired';    label: string; color: string }
  | { kind: 'overdue';    label: string; color: string }
  | { kind: 'due-today';  label: string; color: string }
  | { kind: 'due-soon';   label: string; color: string }
  | { kind: 'ok';         label: string; color: string }
  | { kind: 'none';       label: string; color: string };

function getDeadlineState(item: TaktRequestListItem): DeadlineState {
  const now = new Date();
  const expiredAt = (item as any).expiredAt as string | null | undefined;
  const expiresAt = (item as any).expiresAt as string | null | undefined;
  const due       = item.responseRequiredBy ? new Date(item.responseRequiredBy) : null;

  if (item.status === 'EXPIRED' || expiredAt || (expiresAt && now >= new Date(expiresAt))) {
    const at = expiredAt ?? expiresAt;
    return { kind: 'expired', label: `Abgelaufen${at ? ` am ${format(new Date(at), 'dd.MM.yy HH:mm', { locale: de })}` : ''}`, color: 'text-muted-foreground' };
  }
  if (!due) return { kind: 'none', label: '–', color: 'text-muted-foreground' };

  if (now > due) {
    const h = differenceInHours(now, due);
    const d = differenceInDays(now, due);
    const label = h < 24 ? `Seit ${h}h überfällig` : `Seit ${d}T überfällig`;
    return { kind: 'overdue', label, color: 'text-red-600 font-medium' };
  }

  const h = differenceInHours(due, now);
  if (h <= 8) {
    return { kind: 'due-today', label: `Fällig in ${h}h`, color: 'text-red-600 font-medium' };
  }
  if (h <= 48) {
    const d = differenceInDays(due, now);
    const label = d === 0 ? 'Fällig heute' : d === 1 ? 'Fällig morgen' : `Fällig in ${d} Tagen`;
    return { kind: 'due-soon', label, color: 'text-amber-600' };
  }

  const d = differenceInDays(due, now);
  return { kind: 'ok', label: `Fällig in ${d} Tagen`, color: 'text-foreground' };
}

function canRespond(item: TaktRequestListItem): boolean {
  const state = getDeadlineState(item);
  if (state.kind === 'expired') return false;
  const s = item.status as TaktRequestStatus;
  return ['DELIVERED', 'DETAILS_RETRIEVED', 'UNDER_REVIEW'].includes(s);
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  DRAFT:                 'text-muted-foreground bg-muted/60',
  SENT:                  'text-blue-600 bg-blue-500/10',
  DELIVERED:             'text-blue-600 bg-blue-500/10',
  DETAILS_RETRIEVED:     'text-amber-600 bg-amber-500/10',
  UNDER_REVIEW:          'text-amber-600 bg-amber-500/10',
  ACCEPTED:              'text-emerald-600 bg-emerald-500/10',
  ALTERNATIVES_PROPOSED: 'text-orange-600 bg-orange-500/10',
  REJECTED:              'text-red-600 bg-red-500/10',
  REVISION_REQUIRED:     'text-orange-600 bg-orange-500/10',
  CANCELLED:             'text-muted-foreground bg-muted/40',
  EXPIRED:               'text-muted-foreground bg-muted/40',
  SUPERSEDED:            'text-muted-foreground bg-muted/40',
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT:                 'Entwurf',
  SENT:                  'Gesendet',
  DELIVERED:             'Zugestellt',
  DETAILS_RETRIEVED:     'Abgerufen',
  UNDER_REVIEW:          'In Prüfung',
  ACCEPTED:              'Angenommen',
  ALTERNATIVES_PROPOSED: 'Gegenvorschlag',
  REJECTED:              'Abgelehnt',
  REVISION_REQUIRED:     'Überarbeitung',
  CANCELLED:             'Storniert',
  EXPIRED:               'Abgelaufen',
  SUPERSEDED:            'Ersetzt',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Deadline badge ────────────────────────────────────────────────────────────

function DeadlineBadge({ item }: { item: TaktRequestListItem }) {
  const state = getDeadlineState(item);
  if (state.kind === 'none') return <span className="text-muted-foreground text-xs">–</span>;

  const Icon =
    state.kind === 'expired'   ? Ban :
    state.kind === 'overdue'   ? AlertTriangle :
    state.kind === 'due-today' ? AlertTriangle :
    state.kind === 'due-soon'  ? Clock :
    CheckCircle;

  return (
    <span className={`flex items-center gap-1 text-xs ${state.color}`} aria-label={state.label}>
      <Icon size={11} aria-hidden />
      {state.label}
    </span>
  );
}

// ── Filter ────────────────────────────────────────────────────────────────────

type DeadlineFilter = 'ALL' | 'DUE_SOON' | 'OVERDUE' | 'EXPIRED';
type StatusFilter = TaktRequestStatus | 'ALL';

// ── Main component ────────────────────────────────────────────────────────────

export default function TaktRequestsInboxPage() {
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('ALL');
  const [statusFilter, setStatusFilter]     = useState<StatusFilter>('ALL');

  const {
    data: allItems,
    isLoading,
    isError,
    refetch,
  } = useListTaktRequests(
    { role: 'nu' } as any,
    {
      query: {
        queryKey: getListTaktRequestsQueryKey({ role: 'nu' } as any),
        refetchInterval: 10_000,
        refetchIntervalInBackground: false,
      },
    },
  );

  const filtered = useMemo(() => {
    if (!allItems) return [];
    return allItems.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (deadlineFilter === 'ALL') return true;
      const state = getDeadlineState(item);
      if (deadlineFilter === 'DUE_SOON')  return state.kind === 'due-soon' || state.kind === 'due-today';
      if (deadlineFilter === 'OVERDUE')   return state.kind === 'overdue';
      if (deadlineFilter === 'EXPIRED')   return state.kind === 'expired';
      return true;
    });
  }, [allItems, deadlineFilter, statusFilter]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6 max-w-5xl mx-auto flex flex-col items-center gap-4 py-20">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">Fehler beim Laden der Anfragen</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Erneut versuchen
        </Button>
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (!allItems || allItems.length === 0) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">TaktAnfragen</h1>
        <div className="flex flex-col items-center justify-center py-24 gap-3 border border-dashed rounded-xl">
          <Inbox className="w-12 h-12 text-muted-foreground opacity-40" />
          <p className="font-medium text-muted-foreground">Keine Anfragen eingegangen</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">TaktAnfragen</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Koordinationsanfragen Ihres Unternehmens</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Live
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={deadlineFilter} onValueChange={(v) => setDeadlineFilter(v as DeadlineFilter)}>
          <SelectTrigger className="h-8 w-[200px] text-sm">
            <SelectValue placeholder="Friststatus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Fristen</SelectItem>
            <SelectItem value="DUE_SOON">Bald fällig (≤ 48h)</SelectItem>
            <SelectItem value="OVERDUE">Überfällig</SelectItem>
            <SelectItem value="EXPIRED">Abgelaufen</SelectItem>
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-8 w-[180px] text-sm">
            <SelectValue placeholder="Anfragestatus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Anfrage-Nr.</TableHead>
                <TableHead className="text-xs">Auftraggeber</TableHead>
                <TableHead className="text-xs">Takt</TableHead>
                <TableHead className="text-xs">Antwortfrist</TableHead>
                <TableHead className="text-xs">Friststatus</TableHead>
                <TableHead className="text-xs">Anfragestatus</TableHead>
                <TableHead className="text-xs">Erinnerungen</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Keine Anfragen für diese Filter
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((item) => {
                  const isExpired  = item.status === 'EXPIRED' || !!(item as any).expiredAt;
                  const respond    = canRespond(item);
                  const remCount   = (item as any).reminderCount as number | undefined;

                  return (
                    <TableRow
                      key={item.id}
                      className={`border-border hover:bg-muted/30 transition-colors ${isExpired ? 'opacity-60' : ''}`}
                    >
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {item.requestNumber}
                      </TableCell>
                      <TableCell className="text-sm max-w-[130px] truncate" title={item.nuOrgName}>
                        {item.nuOrgName}
                      </TableCell>
                      <TableCell className="text-sm max-w-[140px] truncate" title={item.taktBezeichnung}>
                        {item.taktBezeichnung}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {item.responseRequiredBy
                          ? format(new Date(item.responseRequiredBy), 'dd.MM.yy HH:mm', { locale: de })
                          : '–'}
                      </TableCell>
                      <TableCell>
                        <DeadlineBadge item={item} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={item.status} />
                      </TableCell>
                      <TableCell>
                        {typeof remCount === 'number' && remCount > 0 ? (
                          <span className="flex items-center gap-1 text-xs text-orange-500">
                            <Bell size={11} aria-hidden />
                            {remCount}×
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">–</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {respond ? (
                          <Link href={`/request-detail/${item.id}`}>
                            <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Antworten">
                              <ChevronRight size={14} />
                            </Button>
                          </Link>
                        ) : isExpired ? (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Die Antwortfrist und der Ablaufzeitpunkt sind überschritten. Eine reguläre Antwort ist nicht mehr möglich."
                            aria-label="Abgelaufen – Antwort nicht mehr möglich"
                          >
                            <Ban size={14} />
                          </span>
                        ) : (
                          <ChevronRight size={14} className="text-muted-foreground/30" />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {filtered.length} von {allItems.length} Anfragen
      </p>
    </div>
  );
}
