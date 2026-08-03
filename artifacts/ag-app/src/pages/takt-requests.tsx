import React, { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import { format, isPast, isAfter, addDays } from 'date-fns';
import {
  useListTaktRequests,
  getListTaktRequestsQueryKey,
  type TaktRequestListItem,
  type TaktRequestStatus,
  type MessageOutboxStatus,
} from '@workspace/api-client-react';
import {
  Send,
  AlertTriangle,
  Clock,
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronRight,
  Inbox,
  ArrowRightLeft,
  Ban,
  Loader2,
} from 'lucide-react';
import { DeadlineStatusBadge } from '@/components/deadline-status-badge';
import { classifyDeadline } from '@/lib/deadline-utils';
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

// ── Types ─────────────────────────────────────────────────────────────────────

type OpenClosedFilter = 'ALL' | 'OPEN' | 'CLOSED';

type DeadlineFilter =
  | 'ALL'
  | 'DUE_SOON'           // bald fällig (≤ 48h)
  | 'DUE_TODAY'          // heute fällig (≤ 8h)
  | 'OVERDUE'            // Antwortfrist überschritten
  | 'EXPIRED'            // abgelaufen
  | 'GU_DECISION'        // GU-Entscheidung ausstehend (guDecisionRequiredBy gesetzt & keine Entscheidung)
  | 'FAILED';            // technische Zustellung fehlgeschlagen

const DEADLINE_FILTER_LABELS: Record<DeadlineFilter, string> = {
  ALL:         'Alle Fristen',
  DUE_SOON:    'Bald fällig',
  DUE_TODAY:   'Heute fällig',
  OVERDUE:     'Überfällig',
  EXPIRED:     'Abgelaufen',
  GU_DECISION: 'GU-Entscheidung ausstehend',
  FAILED:      'Zustellung fehlgeschlagen',
};

function matchesDeadlineFilter(item: TaktRequestListItem, f: DeadlineFilter): boolean {
  if (f === 'ALL') return true;
  if (f === 'FAILED') return item.outboxStatus === 'FAILED';
  if (f === 'EXPIRED') return item.status === 'EXPIRED' || !!(item as any).expiredAt;

  const info = classifyDeadline({
    responseRequiredBy:   (item as any).responseRequiredBy ?? null,
    expiresAt:            (item as any).expiresAt ?? null,
    expiredAt:            (item as any).expiredAt ?? null,
    guDecisionRequiredBy: (item as any).guDecisionRequiredBy ?? null,
  });

  if (f === 'DUE_SOON')    return info.kind === 'due-soon' || info.kind === 'due-today';
  if (f === 'DUE_TODAY')   return info.kind === 'due-today';
  if (f === 'OVERDUE')     return info.kind === 'overdue';
  if (f === 'GU_DECISION') return info.kind === 'gu-decision-overdue' || info.kind === 'gu-decision-due-soon';
  return false;
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const OPEN_STATUSES = new Set<TaktRequestStatus>([
  'DRAFT',
  'SENT',
  'DELIVERED',
  'DETAILS_RETRIEVED',
  'UNDER_REVIEW',
  'ALTERNATIVES_PROPOSED',
  'REVISION_REQUIRED',
]);

const CLOSED_STATUSES = new Set<TaktRequestStatus>([
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'SUPERSEDED',
]);

function isOpen(status: TaktRequestStatus): boolean {
  return OPEN_STATUSES.has(status);
}

/** Fachlicher Status badge */
function RequestStatusBadge({ status }: { status: TaktRequestStatus }) {
  const { t } = useTranslation();
  const label = t(`taktRequests.requestStatus.${status}`, status);

  const variants: Record<TaktRequestStatus, string> = {
    DRAFT:                'text-muted-foreground bg-muted/60',
    SENT:                 'text-blue-600 bg-blue-500/10',
    DELIVERED:            'text-blue-600 bg-blue-500/10',
    DETAILS_RETRIEVED:    'text-amber-600 bg-amber-500/10',
    UNDER_REVIEW:         'text-amber-600 bg-amber-500/10',
    ACCEPTED:             'text-emerald-600 bg-emerald-500/10',
    ALTERNATIVES_PROPOSED:'text-orange-600 bg-orange-500/10',
    REJECTED:             'text-red-600 bg-red-500/10',
    REVISION_REQUIRED:    'text-orange-600 bg-orange-500/10',
    CANCELLED:            'text-muted-foreground bg-muted/40 line-through',
    EXPIRED:              'text-muted-foreground bg-muted/40',
    SUPERSEDED:           'text-muted-foreground bg-muted/40',
  };

  const icons: Partial<Record<TaktRequestStatus, React.ReactNode>> = {
    ACCEPTED:             <CheckCircle className="w-3 h-3" />,
    REJECTED:             <XCircle className="w-3 h-3" />,
    ALTERNATIVES_PROPOSED:<ArrowRightLeft className="w-3 h-3" />,
    CANCELLED:            <Ban className="w-3 h-3" />,
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${variants[status] ?? 'bg-muted text-muted-foreground'}`}
      aria-label={`Anfragestatus: ${label}`}
    >
      {icons[status]}
      {label}
    </span>
  );
}

/** Technischer Nachrichtenstatus badge — visually distinct (blue/purple tones) */
function OutboxStatusBadge({ status }: { status: MessageOutboxStatus | null | undefined }) {
  const { t } = useTranslation();

  if (!status) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-background border border-border text-muted-foreground">
        {t('taktRequests.messageStatus.none')}
      </span>
    );
  }

  const label = t(`taktRequests.messageStatus.${status}`, status);

  const styles: Record<string, string> = {
    PENDING:   'text-slate-500 bg-slate-100 border border-slate-200',
    SENT:      'text-indigo-600 bg-indigo-50 border border-indigo-200',
    DELIVERED: 'text-indigo-700 bg-indigo-100 border border-indigo-300',
    READ:      'text-violet-700 bg-violet-100 border border-violet-300',
    FAILED:    'text-red-700 bg-red-100 border border-red-300',
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] ?? 'bg-muted text-muted-foreground'}`}
      aria-label={`Nachrichtenstatus: ${label}`}
    >
      {status === 'FAILED' && <AlertTriangle className="w-3 h-3" />}
      {label}
    </span>
  );
}

/** Deadline cell with overdue highlight */
function DeadlineCell({ date }: { date: string | null | undefined }) {
  const { t } = useTranslation();
  if (!date) {
    return <span className="text-muted-foreground text-sm">{t('taktRequests.noDeadline')}</span>;
  }
  const d = new Date(date);
  const overdue = isPast(d);
  const soonish = !overdue && isAfter(addDays(new Date(), 3), d);
  return (
    <span className={`text-sm ${overdue ? 'text-red-600 font-medium' : soonish ? 'text-amber-600' : 'text-foreground'}`}>
      {overdue && <Clock className="w-3 h-3 inline mr-1" />}
      {format(d, 'dd.MM.yyyy HH:mm')}
    </span>
  );
}

/** Row-level actions, only showing what's valid for the current status */
function ActionButtons({ item }: { item: TaktRequestListItem }) {
  const { t } = useTranslation();
  const { status, outboxStatus } = item;

  const actions: React.ReactNode[] = [];

  if (status === 'DRAFT') {
    actions.push(
      <Button key="edit" variant="outline" size="sm" className="h-7 text-xs">
        {t('taktRequests.actions.edit')}
      </Button>,
      <Button key="send" size="sm" className="h-7 text-xs">
        <Send className="w-3 h-3 mr-1" />
        {t('taktRequests.actions.send')}
      </Button>,
    );
  } else if (outboxStatus === 'FAILED') {
    actions.push(
      <Button key="resend" variant="outline" size="sm" className="h-7 text-xs">
        <RefreshCw className="w-3 h-3 mr-1" />
        {t('taktRequests.actions.resend')}
      </Button>,
    );
  }

  if (status === 'ALTERNATIVES_PROPOSED' || status === 'ACCEPTED') {
    actions.push(
      <Button key="response" variant="outline" size="sm" className="h-7 text-xs">
        <ChevronRight className="w-3 h-3 mr-1" />
        {t('taktRequests.actions.viewResponse')}
      </Button>,
    );
  }

  if (!CLOSED_STATUSES.has(status) && status !== 'DRAFT') {
    actions.push(
      <Button key="open" variant="ghost" size="sm" className="h-7 text-xs">
        {t('taktRequests.actions.open')}
      </Button>,
    );
  }

  return <div className="flex items-center gap-1 justify-end">{actions}</div>;
}

// ── Unique value helpers for filter dropdowns ─────────────────────────────────

function uniqueProjects(items: TaktRequestListItem[]) {
  const seen = new Map<string, string>();
  items.forEach((r) => seen.set(r.projectId, r.projectName));
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

function uniqueContractors(items: TaktRequestListItem[]) {
  const seen = new Map<string, string>();
  items.forEach((r) => seen.set(r.nuOrgId, r.nuOrgName));
  return [...seen.entries()].map(([id, name]) => ({ id, name }));
}

// ── Main page component ───────────────────────────────────────────────────────

const ALL_STATUSES: TaktRequestStatus[] = [
  'DRAFT',
  'SENT',
  'DELIVERED',
  'DETAILS_RETRIEVED',
  'UNDER_REVIEW',
  'ACCEPTED',
  'ALTERNATIVES_PROPOSED',
  'REJECTED',
  'REVISION_REQUIRED',
  'CANCELLED',
  'EXPIRED',
  'SUPERSEDED',
];

export default function TaktRequestsPage() {
  const { t } = useTranslation();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [openClosed, setOpenClosed] = useState<OpenClosedFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<TaktRequestStatus | 'ALL'>('ALL');
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [nuFilter, setNuFilter] = useState<string>('ALL');
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('ALL');

  // ── Data fetching ───────────────────────────────────────────────────────────
  // Pass server-side status filter when a specific status is chosen; otherwise
  // fetch all and filter client-side for the open/closed tab.
  const apiStatusFilter =
    statusFilter !== 'ALL' ? statusFilter : undefined;

  const {
    data: allItems,
    isLoading,
    isError,
    refetch,
  } = useListTaktRequests(
    apiStatusFilter ? { status: apiStatusFilter } : undefined,
    {
      query: {
        queryKey: getListTaktRequestsQueryKey(apiStatusFilter ? { status: apiStatusFilter } : undefined),
        // Poll every 8 s — will stop once data is all-closed (see staleTime below)
        refetchInterval: (query) => {
          const data = query.state.data as TaktRequestListItem[] | undefined;
          if (!data) return 8_000;
          const hasOpen = data.some((r) => isOpen(r.status as TaktRequestStatus));
          return hasOpen ? 8_000 : false;
        },
        refetchIntervalInBackground: false,
      },
    },
  );

  // ── Client-side filtering & sorting ────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!allItems) return [];

    return allItems
      .filter((r) => {
        const s = r.status as TaktRequestStatus;
        if (openClosed === 'OPEN' && !isOpen(s)) return false;
        if (openClosed === 'CLOSED' && !CLOSED_STATUSES.has(s)) return false;
        if (projectFilter !== 'ALL' && r.projectId !== projectFilter) return false;
        if (nuFilter !== 'ALL' && r.nuOrgId !== nuFilter) return false;
        if (!matchesDeadlineFilter(r, deadlineFilter)) return false;
        return true;
      })
      .sort((a, b) => {
        // Open requests first
        const aOpen = isOpen(a.status as TaktRequestStatus) ? 0 : 1;
        const bOpen = isOpen(b.status as TaktRequestStatus) ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        // Then newest first
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [allItems, openClosed, statusFilter, projectFilter, nuFilter]);

  const projects = useMemo(() => (allItems ? uniqueProjects(allItems) : []), [allItems]);
  const contractors = useMemo(() => (allItems ? uniqueContractors(allItems) : []), [allItems]);

  // ── Loading state ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="h-8 w-64"><Skeleton className="h-full w-full" /></div>
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex flex-col items-center justify-center py-20 gap-4">
          <AlertTriangle className="w-10 h-10 text-destructive" />
          <p className="text-muted-foreground">{t('taktRequests.error')}</p>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('taktRequests.retry')}
          </Button>
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (!allItems || allItems.length === 0) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{t('taktRequests.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('taktRequests.description')}</p>
        </div>
        <div className="flex flex-col items-center justify-center py-24 gap-3 border border-dashed rounded-xl">
          <Inbox className="w-12 h-12 text-muted-foreground opacity-40" />
          <p className="font-medium text-muted-foreground">{t('taktRequests.empty')}</p>
          <p className="text-sm text-muted-foreground/70">{t('taktRequests.emptyHint')}</p>
        </div>
      </div>
    );
  }

  // ── Main view ───────────────────────────────────────────────────────────────
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{t('taktRequests.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('taktRequests.description')}</p>
        </div>
        {/* Status indicator while polling */}
        {allItems.some((r) => isOpen(r.status as TaktRequestStatus)) && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Live
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Open / Closed tabs */}
        <div className="flex rounded-md border border-border overflow-hidden text-sm">
          {(['ALL', 'OPEN', 'CLOSED'] as OpenClosedFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setOpenClosed(v)}
              className={`px-3 py-1.5 transition-colors ${openClosed === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/60 text-muted-foreground'}`}
            >
              {t(`taktRequests.filter.${v.toLowerCase()}`)}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TaktRequestStatus | 'ALL')}>
          <SelectTrigger className="h-8 w-[180px] text-sm">
            <SelectValue placeholder={t('taktRequests.filter.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('taktRequests.filter.allStatuses')}</SelectItem>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`taktRequests.requestStatus.${s}`, s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Project filter */}
        {projects.length > 1 && (
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-8 w-[180px] text-sm">
              <SelectValue placeholder={t('taktRequests.filter.project')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('taktRequests.filter.allProjects')}</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Contractor filter */}
        {contractors.length > 1 && (
          <Select value={nuFilter} onValueChange={setNuFilter}>
            <SelectTrigger className="h-8 w-[180px] text-sm">
              <SelectValue placeholder={t('taktRequests.filter.contractor')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('taktRequests.filter.allContractors')}</SelectItem>
              {contractors.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Deadline filter */}
        <Select value={deadlineFilter} onValueChange={(v) => setDeadlineFilter(v as DeadlineFilter)}>
          <SelectTrigger className="h-8 w-[220px] text-sm">
            <SelectValue placeholder="Friststatus" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DEADLINE_FILTER_LABELS) as DeadlineFilter[]).map((key) => (
              <SelectItem key={key} value={key}>{DEADLINE_FILTER_LABELS[key]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border">
                <TableHead className="text-xs">{t('taktRequests.columns.requestNumber')}</TableHead>
                <TableHead className="text-xs">{t('taktRequests.columns.project')}</TableHead>
                <TableHead className="text-xs">{t('taktRequests.columns.takt')}</TableHead>
                <TableHead className="text-xs text-center">{t('taktRequests.columns.version')}</TableHead>
                <TableHead className="text-xs">{t('taktRequests.columns.contractor')}</TableHead>
                <TableHead className="text-xs">{t('taktRequests.columns.deadline')}</TableHead>
                <TableHead className="text-xs">Friststatus</TableHead>
                <TableHead className="text-xs">{t('taktRequests.columns.requestStatus')}</TableHead>
                <TableHead className="text-xs">{t('taktRequests.columns.messageStatus')}</TableHead>
                <TableHead className="text-xs">{t('taktRequests.columns.createdAt')}</TableHead>
                <TableHead className="text-xs">{t('taktRequests.columns.updatedAt')}</TableHead>
                <TableHead className="text-xs text-right">{t('taktRequests.columns.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-16 text-center text-muted-foreground text-sm">
                    {t('taktRequests.emptyFiltered')}
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((item) => (
                  <TableRow
                    key={item.id}
                    className={`border-border hover:bg-muted/30 transition-colors ${CLOSED_STATUSES.has(item.status as TaktRequestStatus) ? 'opacity-60' : ''}`}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {item.requestNumber}
                    </TableCell>
                    <TableCell className="text-sm max-w-[140px] truncate" title={item.projectName}>
                      {item.projectName}
                    </TableCell>
                    <TableCell className="text-sm max-w-[140px] truncate" title={item.taktBezeichnung}>
                      {item.taktBezeichnung}
                    </TableCell>
                    <TableCell className="text-sm text-center">
                      <Badge variant="outline" className="text-xs">v{item.taktVersion}</Badge>
                    </TableCell>
                    <TableCell className="text-sm max-w-[140px] truncate" title={item.nuOrgName}>
                      {item.nuOrgName}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <DeadlineCell date={item.responseRequiredBy ?? null} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <DeadlineStatusBadge
                        responseRequiredBy={(item as any).responseRequiredBy}
                        expiresAt={(item as any).expiresAt}
                        expiredAt={(item as any).expiredAt}
                        guDecisionRequiredBy={(item as any).guDecisionRequiredBy}
                        compact
                      />
                    </TableCell>
                    <TableCell>
                      <RequestStatusBadge status={item.status as TaktRequestStatus} />
                    </TableCell>
                    <TableCell>
                      <OutboxStatusBadge status={(item.outboxStatus as MessageOutboxStatus) ?? null} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(item.createdAt), 'dd.MM.yy HH:mm')}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(item.updatedAt), 'dd.MM.yy HH:mm')}
                    </TableCell>
                    <TableCell>
                      <ActionButtons item={item} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Row count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} von {allItems.length} Anfragen
      </p>
    </div>
  );
}
