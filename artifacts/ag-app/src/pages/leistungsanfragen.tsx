import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
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
  Building2,
  FolderOpen,
  Calendar,
} from 'lucide-react';
import { DeadlineStatusBadge } from '@/components/deadline-status-badge';
import { classifyDeadline } from '@/lib/deadline-utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import {
  AccordionContent,
  AccordionItem,
} from '@/components/ui/accordion';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Types ─────────────────────────────────────────────────────────────────────

type OpenClosedFilter = 'ALL' | 'OPEN' | 'CLOSED';
type CoordinationFilter = 'ALL' | 'AGREED' | 'NO_AGREEMENT' | 'AG_ACTION_REQUIRED' | 'AN_ACTION_REQUIRED';
type ProposalFilter = 'ALL' | 'OPEN' | 'NONE';
type ActionOwnerFilter = 'ALL' | 'AG' | 'AN' | 'NONE';
type ScheduleFilter = 'ALL' | 'CHANGED' | 'UNCHANGED';

type DeadlineFilter =
  | 'ALL'
  | 'DUE_SOON'
  | 'DUE_TODAY'
  | 'OVERDUE'
  | 'EXPIRED'
  | 'GU_DECISION'
  | 'FAILED';

const DEADLINE_FILTER_LABELS: Record<DeadlineFilter, string> = {
  ALL:         'Alle Fristen',
  DUE_SOON:    'Bald fällig',
  DUE_TODAY:   'Heute fällig',
  OVERDUE:     'Überfällig',
  EXPIRED:     'Abgelaufen',
  GU_DECISION: 'GU-Entscheidung ausstehend',
  FAILED:      'Zustellung fehlgeschlagen',
};

const COORDINATION_LABELS: Record<CoordinationFilter, string> = {
  ALL: 'Alle Koordination',
  AGREED: 'Vereinbart',
  NO_AGREEMENT: 'Keine Vereinbarung',
  AG_ACTION_REQUIRED: 'AG muss handeln',
  AN_ACTION_REQUIRED: 'AN muss handeln',
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
  'DRAFT', 'SENT', 'DELIVERED', 'DETAILS_RETRIEVED',
  'UNDER_REVIEW', 'ALTERNATIVES_PROPOSED', 'REVISION_REQUIRED',
]);

const CLOSED_STATUSES = new Set<TaktRequestStatus>([
  'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED',
]);

function isOpen(status: TaktRequestStatus): boolean {
  return OPEN_STATUSES.has(status);
}

// Status display config
const STATUS_CONFIG: Record<TaktRequestStatus, { label: string; className: string; icon?: React.ReactNode }> = {
  DRAFT:                { label: 'Entwurf',           className: 'text-muted-foreground bg-muted/60' },
  SENT:                 { label: 'Gesendet',           className: 'text-blue-600 bg-blue-500/10' },
  DELIVERED:            { label: 'Zugestellt',         className: 'text-blue-600 bg-blue-500/10' },
  DETAILS_RETRIEVED:    { label: 'Abgerufen',          className: 'text-amber-600 bg-amber-500/10' },
  UNDER_REVIEW:         { label: 'In Prüfung',         className: 'text-amber-600 bg-amber-500/10' },
  ACCEPTED:             { label: 'Angenommen',         className: 'text-emerald-600 bg-emerald-500/10', icon: <CheckCircle className="w-3 h-3" /> },
  ALTERNATIVES_PROPOSED:{ label: 'Gegenvorschlag',     className: 'text-orange-600 bg-orange-500/10', icon: <ArrowRightLeft className="w-3 h-3" /> },
  REJECTED:             { label: 'Abgelehnt',          className: 'text-red-600 bg-red-500/10',        icon: <XCircle className="w-3 h-3" /> },
  REVISION_REQUIRED:    { label: 'Revision erforderlich', className: 'text-orange-600 bg-orange-500/10' },
  CANCELLED:            { label: 'Storniert',          className: 'text-muted-foreground bg-muted/40', icon: <Ban className="w-3 h-3" /> },
  EXPIRED:              { label: 'Abgelaufen',         className: 'text-muted-foreground bg-muted/40' },
  SUPERSEDED:           { label: 'Ersetzt',            className: 'text-muted-foreground bg-muted/40' },
};

function StatusBadge({ status }: { status: TaktRequestStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, className: 'bg-muted text-muted-foreground' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap flex-shrink-0 ${cfg.className}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function OutboxStatusBadge({ status }: { status: MessageOutboxStatus | null | undefined }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const styles: Record<string, string> = {
    PENDING:   'text-slate-500',
    SENT:      'text-indigo-600',
    DELIVERED: 'text-indigo-700',
    READ:      'text-violet-700',
    FAILED:    'text-red-600 font-semibold',
  };
  const labels: Record<string, string> = {
    PENDING: 'Ausstehend', SENT: 'Gesendet', DELIVERED: 'Zugestellt',
    READ: 'Gelesen', FAILED: 'Fehlgeschlagen',
  };
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${styles[status] ?? 'text-muted-foreground'}`}>
      {status === 'FAILED' && <AlertTriangle className="w-3 h-3" />}
      {labels[status] ?? status}
    </span>
  );
}

function DeadlineText({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="text-muted-foreground text-xs">—</span>;
  const d = new Date(date);
  const overdue = isPast(d);
  const soonish = !overdue && isAfter(addDays(new Date(), 3), d);
  return (
    <span className={`text-xs whitespace-nowrap ${overdue ? 'text-red-600 font-semibold' : soonish ? 'text-amber-600' : 'text-muted-foreground'}`}>
      {overdue && <Clock className="w-3 h-3 inline mr-0.5" />}
      {format(d, 'dd.MM.yy HH:mm')}
    </span>
  );
}

// ── Unique value helpers ───────────────────────────────────────────────────────

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

// ── Status list for filter dropdown ───────────────────────────────────────────

const ALL_STATUSES: TaktRequestStatus[] = [
  'DRAFT', 'SENT', 'DELIVERED', 'DETAILS_RETRIEVED', 'UNDER_REVIEW',
  'ACCEPTED', 'ALTERNATIVES_PROPOSED', 'REJECTED', 'REVISION_REQUIRED',
  'CANCELLED', 'EXPIRED', 'SUPERSEDED',
];

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LeistungsanfragenPage() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  // ── Filter state ─────────────────────────────────────────────────────────────
  const [openClosed, setOpenClosed]       = useState<OpenClosedFilter>('ALL');
  const [statusFilter, setStatusFilter]   = useState<TaktRequestStatus | 'ALL'>('ALL');
  const [projectFilter, setProjectFilter] = useState<string>('ALL');
  const [nuFilter, setNuFilter]           = useState<string>('ALL');
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('ALL');
  const [coordinationFilter, setCoordinationFilter] = useState<CoordinationFilter>('ALL');
  const [proposalFilter, setProposalFilter] = useState<ProposalFilter>('ALL');
  const [actionOwnerFilter, setActionOwnerFilter] = useState<ActionOwnerFilter>('ALL');
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('ALL');

  // ── Data ─────────────────────────────────────────────────────────────────────
  const apiStatusFilter = statusFilter !== 'ALL' ? statusFilter : undefined;

  const { data: allItems, isLoading, isError, refetch } = useListTaktRequests(
    apiStatusFilter ? { status: apiStatusFilter } : undefined,
    {
      query: {
        queryKey: getListTaktRequestsQueryKey(apiStatusFilter ? { status: apiStatusFilter } : undefined),
        refetchInterval: (query) => {
          const data = query.state.data as TaktRequestListItem[] | undefined;
          if (!data) return 8_000;
          return data.some((r) => isOpen(r.status as TaktRequestStatus)) ? 8_000 : false;
        },
        refetchIntervalInBackground: false,
      },
    },
  );

  // ── Client-side filter + sort ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!allItems) return [];
    return allItems
      .filter((r) => {
        const s = r.status as TaktRequestStatus;
        if (openClosed === 'OPEN'   && !isOpen(s))             return false;
        if (openClosed === 'CLOSED' && !CLOSED_STATUSES.has(s)) return false;
        if (projectFilter !== 'ALL' && r.projectId !== projectFilter) return false;
        if (nuFilter !== 'ALL' && r.nuOrgId !== nuFilter)       return false;
        if (!matchesDeadlineFilter(r, deadlineFilter))           return false;
        if (coordinationFilter !== 'ALL' && r.coordinationState !== coordinationFilter) return false;
        if (proposalFilter === 'OPEN' && !r.openProposal) return false;
        if (proposalFilter === 'NONE' && r.openProposal) return false;
        if (actionOwnerFilter === 'NONE' && r.nextActionOwner) return false;
        if (actionOwnerFilter !== 'ALL' && actionOwnerFilter !== 'NONE' && r.nextActionOwner !== actionOwnerFilter) return false;
        if (scheduleFilter === 'CHANGED' && !r.scheduleDelta.hasChange) return false;
        if (scheduleFilter === 'UNCHANGED' && r.scheduleDelta.hasChange) return false;
        return true;
      })
      .sort((a, b) => {
        const aOpen = isOpen(a.status as TaktRequestStatus) ? 0 : 1;
        const bOpen = isOpen(b.status as TaktRequestStatus) ? 0 : 1;
        if (aOpen !== bOpen) return aOpen - bOpen;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [allItems, openClosed, statusFilter, projectFilter, nuFilter, deadlineFilter, coordinationFilter, proposalFilter, actionOwnerFilter, scheduleFilter]);

  const projects    = useMemo(() => (allItems ? uniqueProjects(allItems)    : []), [allItems]);
  const contractors = useMemo(() => (allItems ? uniqueContractors(allItems) : []), [allItems]);

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <div className="space-y-2">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="max-w-5xl mx-auto flex flex-col items-center justify-center py-20 gap-4">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">{t('taktRequests.error')}</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />{t('taktRequests.retry')}
        </Button>
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────────────
  if (!allItems || allItems.length === 0) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
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

  const hasOpenItems = allItems.some((r) => isOpen(r.status as TaktRequestStatus));

  // ── Main ──────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-5xl mx-auto animate-in fade-in duration-300">

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {t('taktRequests.title')}
            {hasOpenItems && (
              <span className="text-sm font-normal text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Live
              </span>
            )}
          </h1>
          <p className="text-muted-foreground mt-0.5 text-sm">{t('taktRequests.description')}</p>
        </div>
        <p className="text-xs text-muted-foreground shrink-0">
          {filtered.length} / {allItems.length} Anfragen
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* Open / Closed tabs */}
        <div className="flex rounded-lg border border-border overflow-hidden text-sm shrink-0">
          {(['ALL', 'OPEN', 'CLOSED'] as OpenClosedFilter[]).map((v) => (
            <button
              key={v}
              onClick={() => setOpenClosed(v)}
              className={`px-3 py-1.5 transition-colors ${
                openClosed === v
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'hover:bg-muted/60 text-muted-foreground'
              }`}
            >
              {t(`taktRequests.filter.${v.toLowerCase()}`)}
            </button>
          ))}
        </div>

        {/* Status */}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as TaktRequestStatus | 'ALL')}>
          <SelectTrigger className="h-8 w-[170px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Status</SelectItem>
            {ALL_STATUSES.map(s => (
              <SelectItem key={s} value={s}>{STATUS_CONFIG[s]?.label ?? s}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Project */}
        {projects.length > 1 && (
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-8 w-[170px] text-sm">
              <SelectValue placeholder="Projekt" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Projekte</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {/* Contractor */}
        {contractors.length > 1 && (
          <Select value={nuFilter} onValueChange={setNuFilter}>
            <SelectTrigger className="h-8 w-[170px] text-sm">
              <SelectValue placeholder="Nachunternehmen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle NU</SelectItem>
              {contractors.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {/* Deadline */}
        <Select value={deadlineFilter} onValueChange={(v) => setDeadlineFilter(v as DeadlineFilter)}>
          <SelectTrigger className="h-8 w-[200px] text-sm">
            <SelectValue placeholder="Friststatus" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DEADLINE_FILTER_LABELS) as DeadlineFilter[]).map(key => (
              <SelectItem key={key} value={key}>{DEADLINE_FILTER_LABELS[key]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={coordinationFilter} onValueChange={(v) => setCoordinationFilter(v as CoordinationFilter)}>
          <SelectTrigger className="h-8 w-[180px] text-sm"><SelectValue placeholder="Koordination" /></SelectTrigger>
          <SelectContent>{Object.entries(COORDINATION_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={proposalFilter} onValueChange={(v) => setProposalFilter(v as ProposalFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-sm"><SelectValue placeholder="Vorschlag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Vorschläge</SelectItem>
            <SelectItem value="OPEN">Offener Vorschlag</SelectItem>
            <SelectItem value="NONE">Kein offener Vorschlag</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actionOwnerFilter} onValueChange={(v) => setActionOwnerFilter(v as ActionOwnerFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-sm"><SelectValue placeholder="Nächste Aktion" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle nächsten Aktionen</SelectItem>
            <SelectItem value="AG">AG ist am Zug</SelectItem>
            <SelectItem value="AN">AN ist am Zug</SelectItem>
            <SelectItem value="NONE">Keine Aktion offen</SelectItem>
          </SelectContent>
        </Select>
        <Select value={scheduleFilter} onValueChange={(v) => setScheduleFilter(v as ScheduleFilter)}>
          <SelectTrigger className="h-8 w-[160px] text-sm"><SelectValue placeholder="Terminänderung" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Terminstände</SelectItem>
            <SelectItem value="CHANGED">Mit Terminänderung</SelectItem>
            <SelectItem value="UNCHANGED">Ohne Terminänderung</SelectItem>
          </SelectContent>
        </Select>

        {/* Reset */}
        {(openClosed !== 'ALL' || statusFilter !== 'ALL' || projectFilter !== 'ALL' || nuFilter !== 'ALL' || deadlineFilter !== 'ALL' || coordinationFilter !== 'ALL' || proposalFilter !== 'ALL' || actionOwnerFilter !== 'ALL' || scheduleFilter !== 'ALL') && (
          <button
            onClick={() => { setOpenClosed('ALL'); setStatusFilter('ALL'); setProjectFilter('ALL'); setNuFilter('ALL'); setDeadlineFilter('ALL'); setCoordinationFilter('ALL'); setProposalFilter('ALL'); setActionOwnerFilter('ALL'); setScheduleFilter('ALL'); }}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* Accordion list */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground text-sm border border-dashed rounded-xl">
          {t('taktRequests.emptyFiltered')}
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden bg-card divide-y divide-border">
          <AccordionPrimitive.Root type="single" collapsible>
            {filtered.map((item) => {
              const closed = CLOSED_STATUSES.has(item.status as TaktRequestStatus);
              return (
                <AccordionItem
                  key={item.id}
                  value={item.id}
                  className={`border-0 ${closed ? 'opacity-60' : ''}`}
                >
                  {/* Header: trigger + Öffnen side-by-side (no button-in-button) */}
                  <AccordionPrimitive.Header className="flex items-stretch hover:bg-muted/30 transition-colors [&[data-state=open]]:bg-muted/20">

                    {/* Clickable expand area */}
                    <AccordionPrimitive.Trigger className="flex flex-1 items-center gap-3 px-4 py-3 min-w-0 text-left [&[data-state=open]>span.chevron]:rotate-180">

                      {/* Status badge */}
                      <StatusBadge status={item.status as TaktRequestStatus} />

                      {/* Main info */}
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate leading-tight">
                          {item.taktBezeichnung}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <FolderOpen className="w-3 h-3 opacity-60" />
                            {item.projectName}
                          </span>
                          {item.openProposal && (
                            <span className="text-xs font-medium text-orange-600 bg-orange-500/10 rounded-full px-2 py-0.5">
                              Offener Vorschlag · {item.nextActionOwner === 'AG' ? 'AG am Zug' : 'AN am Zug'}
                            </span>
                          )}
                          <span className="text-muted-foreground/40 text-xs">·</span>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Building2 className="w-3 h-3 opacity-60" />
                            {item.nuOrgName}
                          </span>
                        </div>
                      </div>

                      {/* Deadline info (desktop) */}
                      <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
                        <DeadlineStatusBadge
                          responseRequiredBy={(item as any).responseRequiredBy}
                          expiresAt={(item as any).expiresAt}
                          expiredAt={(item as any).expiredAt}
                          guDecisionRequiredBy={(item as any).guDecisionRequiredBy}
                          compact
                        />
                        {(item as any).responseRequiredBy && (
                          <DeadlineText date={(item as any).responseRequiredBy} />
                        )}
                      </div>

                      {/* Chevron */}
                      <span className="chevron ml-1 flex-shrink-0 transition-transform duration-200">
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      </span>
                    </AccordionPrimitive.Trigger>

                    {/* Öffnen — sibling to trigger, NOT nested inside it */}
                    <div className="flex items-center px-3 border-l border-border/50 flex-shrink-0">
                      <Link
                        href={`/projects/${item.projectId}`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        title={`Projekt öffnen: ${item.projectName}`}
                        aria-label={`Projekt öffnen: ${item.projectName}`}
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span className="hidden md:inline">Projekt</span>
                      </Link>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setLocation(`/leistungsanfragen/${item.id}`)}
                      >
                        <ChevronRight className="w-3 h-3 mr-1" />
                        Öffnen
                      </Button>
                    </div>
                  </AccordionPrimitive.Header>

                  {/* Expanded body */}
                  <AccordionContent className="px-4 pb-4 pt-0">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-sm bg-muted/20 rounded-lg p-3 border border-border/50">

                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Nr.</div>
                        <div className="font-mono text-xs">{item.requestNumber}</div>
                      </div>

                      <div className="col-span-2 sm:col-span-4 border-t border-border/50 pt-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Koordination</div>
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-medium">{COORDINATION_LABELS[item.coordinationState as CoordinationFilter] ?? item.coordinationState}</span>
                          {item.currentAgreement ? (
                            <span className="text-muted-foreground">Vereinbart: {format(new Date(item.currentAgreement.start), 'dd.MM.yy')}–{format(new Date(item.currentAgreement.end), 'dd.MM.yy')}</span>
                          ) : <span className="text-muted-foreground">Noch keine Vereinbarung</span>}
                          {item.openProposal && <span className="text-orange-600">Vorschlag: {format(new Date(item.openProposal.start), 'dd.MM.yy')}–{format(new Date(item.openProposal.end), 'dd.MM.yy')}</span>}
                          {item.scheduleDelta.hasChange && <span className="text-amber-600">Δ {item.scheduleDelta.startDays > 0 ? '+' : ''}{item.scheduleDelta.startDays} / {item.scheduleDelta.endDays > 0 ? '+' : ''}{item.scheduleDelta.endDays} Tage</span>}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Version</div>
                        <div className="text-xs">v{item.taktVersion}</div>
                      </div>

                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Zustellung</div>
                        <OutboxStatusBadge status={(item.outboxStatus as MessageOutboxStatus) ?? null} />
                      </div>

                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Antwortfrist</div>
                        <DeadlineText date={(item as any).responseRequiredBy} />
                      </div>

                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Erstellt</div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3 opacity-60" />
                          {format(new Date(item.createdAt), 'dd.MM.yy HH:mm')}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Zuletzt aktualisiert</div>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3 opacity-60" />
                          {format(new Date(item.updatedAt), 'dd.MM.yy HH:mm')}
                        </div>
                      </div>

                      {/* Mobile: deadline info */}
                      <div className="col-span-2 sm:hidden">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">Antwortfrist</div>
                        <div className="flex items-center gap-2">
                          <DeadlineStatusBadge
                            responseRequiredBy={(item as any).responseRequiredBy}
                            expiresAt={(item as any).expiresAt}
                            expiredAt={(item as any).expiredAt}
                            guDecisionRequiredBy={(item as any).guDecisionRequiredBy}
                            compact
                          />
                          <DeadlineText date={(item as any).responseRequiredBy} />
                        </div>
                      </div>
                    </div>

                    {/* FAILED alert */}
                    {item.outboxStatus === 'FAILED' && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-red-600 bg-red-500/8 border border-red-500/20 rounded-lg px-3 py-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        Technische Zustellung fehlgeschlagen — bitte Verbindung prüfen.
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </AccordionPrimitive.Root>
        </div>
      )}
    </div>
  );
}
