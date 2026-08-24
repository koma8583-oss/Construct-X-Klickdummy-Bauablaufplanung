/**
 * Leistungsanfragen Inbox — Task 7.7 / Task #196
 *
 * Shows Leistungsanfragen (TaktRequests) sent to this AN-Organisation.
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
  useListAnProjectInvitations,
  getListAnProjectInvitationsQueryKey,
  useAcceptAnProjectInvitation,
  useRejectAnProjectInvitation,
  type AnProjectInvitation,
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
  Building2,
  ShieldCheck,
  Lock,
  CheckCircle2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
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
  return ['DELIVERED', 'DETAILS_RETRIEVED', 'UNDER_REVIEW', 'REVISION_REQUIRED'].includes(s);
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
  if (state.kind === 'none') return null;

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
type CoordinationFilter = 'ALL' | 'AGREED' | 'NO_AGREEMENT' | 'AG_ACTION_REQUIRED' | 'AN_ACTION_REQUIRED';
type ProposalFilter = 'ALL' | 'OPEN' | 'NONE';
type ActionOwnerFilter = 'ALL' | 'AG' | 'AN' | 'NONE';
type ScheduleFilter = 'ALL' | 'CHANGED' | 'UNCHANGED';
type InboxFilter = 'ALL' | 'OPEN' | 'DONE';

export type InboxItem =
  | {
      kind: 'invitation';
      data: AnProjectInvitation;
      receivedAt: string;
      isOpen: boolean;
    }
  | {
      kind: 'service-request';
      data: TaktRequestListItem;
      receivedAt: string;
      isOpen: boolean;
    };

const COMPLETED_REQUEST_STATUSES = new Set<TaktRequestStatus>([
  'ACCEPTED',
  'REJECTED',
  'EXPIRED',
  'CANCELLED',
  'SUPERSEDED',
]);

function isCompletedRequest(item: TaktRequestListItem): boolean {
  return COMPLETED_REQUEST_STATUSES.has(item.status);
}

export interface InboxFilterState {
  inboxFilter: InboxFilter;
  deadlineFilter: DeadlineFilter;
  statusFilter: StatusFilter;
  coordinationFilter: CoordinationFilter;
  proposalFilter: ProposalFilter;
  actionOwnerFilter: ActionOwnerFilter;
  scheduleFilter: ScheduleFilter;
}

export function filterInboxItems(
  allItems: InboxItem[],
  {
    inboxFilter,
    deadlineFilter,
    statusFilter,
    coordinationFilter,
    proposalFilter,
    actionOwnerFilter,
    scheduleFilter,
  }: InboxFilterState,
): InboxItem[] {
  const serviceFilterActive = [
    deadlineFilter,
    statusFilter,
    coordinationFilter,
    proposalFilter,
    actionOwnerFilter,
    scheduleFilter,
  ].some((filter) => filter !== 'ALL');

  return allItems.filter((item) => {
    if (inboxFilter !== 'ALL' && (inboxFilter === 'OPEN') !== item.isOpen) return false;
    if (item.kind === 'invitation') return !serviceFilterActive;
    const request = item.data;
    if (statusFilter !== 'ALL' && request.status !== statusFilter) return false;
    if (deadlineFilter !== 'ALL') {
      const state = getDeadlineState(request);
      if (deadlineFilter === 'DUE_SOON' && !(state.kind === 'due-soon' || state.kind === 'due-today')) return false;
      if (deadlineFilter === 'OVERDUE' && state.kind !== 'overdue') return false;
      if (deadlineFilter === 'EXPIRED' && state.kind !== 'expired') return false;
    }
    if (coordinationFilter !== 'ALL' && request.coordinationState !== coordinationFilter) return false;
    if (proposalFilter === 'OPEN' && !request.openProposal) return false;
    if (proposalFilter === 'NONE' && request.openProposal) return false;
    if (actionOwnerFilter === 'NONE' && request.nextActionOwner) return false;
    if (actionOwnerFilter !== 'ALL' && actionOwnerFilter !== 'NONE' && request.nextActionOwner !== actionOwnerFilter) return false;
    if (scheduleFilter === 'CHANGED' && !request.scheduleDelta.hasChange) return false;
    if (scheduleFilter === 'UNCHANGED' && request.scheduleDelta.hasChange) return false;
    return true;
  });
}

function formatReceivedAt(value: string): string {
  try {
    return format(new Date(value), 'dd.MM.yyyy HH:mm', { locale: de });
  } catch {
    return value;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function policyText(policy: Record<string, unknown>, key: string): string | null {
  const value = policy[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function policyList(policy: Record<string, unknown>, key: string): string[] {
  return isStringArray(policy[key]) ? policy[key] : [];
}

function InvitationStatusBadge({ status }: { status: AnProjectInvitation['status'] }) {
  const labels = {
    PENDING: 'Offen',
    ACCEPTED: 'Beigetreten',
    REJECTED: 'Abgelehnt',
  } as const;
  const styles = {
    PENDING: 'text-amber-700 bg-amber-500/10',
    ACCEPTED: 'text-emerald-700 bg-emerald-500/10',
    REJECTED: 'text-red-700 bg-red-500/10',
  } as const;
  return <Badge className={styles[status]}>{labels[status]}</Badge>;
}

function ProjectInvitationCard({ invitation }: { invitation: AnProjectInvitation }) {
  const [policyConfirmed, setPolicyConfirmed] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const accept = useAcceptAnProjectInvitation();
  const reject = useRejectAnProjectInvitation();
  const isBusy = accept.isPending || reject.isPending;
  const policy = (invitation.policySnapshot ?? {}) as Record<string, unknown>;
  const policyName = policyText(policy, 'name') ?? 'Nutzungsrichtlinie';
  const policyPurpose = policyText(policy, 'purpose') ?? policyText(policy, 'usagePurpose');
  const permissions = policyList(policy, 'permissions');
  const prohibitions = policyList(policy, 'prohibitions');
  const validityRule = policyText(policy, 'validityRule');

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: getListAnProjectInvitationsQueryKey() });
  };

  const decide = async (action: 'accept' | 'reject') => {
    try {
      const input = action === 'accept' ? { policyAccepted: true } : {};
      const mutation = action === 'accept' ? accept : reject;
      await mutation.mutateAsync({ id: invitation.id, data: input });
      toast({
        title: action === 'accept' ? 'Projekt und Datenfreigabe angenommen' : 'Einladung abgelehnt',
      });
      await refresh();
    } catch (error) {
      toast({
        title: 'Fehler',
        description: error instanceof Error ? error.message : 'Aktion konnte nicht ausgeführt werden.',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Building2 className="h-5 w-5 shrink-0 text-primary" />
            <CardTitle className="truncate text-lg">{invitation.projectName}</CardTitle>
          </div>
          <InvitationStatusBadge status={invitation.status} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">Projekteinladung</Badge>
          <span className="text-xs text-muted-foreground">
            Eingegangen: {formatReceivedAt(invitation.createdAt)}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Einladung vom Auftraggeber <strong>{invitation.senderAgOrgId}</strong>
        </p>
        {invitation.projectLocation && <p className="text-sm">{invitation.projectLocation}</p>}
        {invitation.projectDescription && <p className="text-sm">{invitation.projectDescription}</p>}
        {invitation.invitationMessage && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">{invitation.invitationMessage}</div>
        )}
        {invitation.dataPublicationTitle && (
          <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lock className="h-4 w-4 text-primary" />
              Datenangebot: {invitation.dataPublicationTitle}
            </div>
            <div className="flex flex-wrap gap-1">
              {invitation.selectedFields?.map((field) => (
                <Badge key={field} variant="secondary" className="text-[10px]">{field}</Badge>
              ))}
            </div>
          </div>
        )}
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <ShieldCheck className="h-4 w-4 text-primary" />{policyName}
          </div>
          {policyPurpose && <p className="text-muted-foreground">{policyPurpose}</p>}
          {permissions.length > 0 && <p><strong>Erlaubt:</strong> {permissions.join(', ')}</p>}
          {prohibitions.length > 0 && <p><strong>Nicht erlaubt:</strong> {prohibitions.join(', ')}</p>}
          {validityRule && <p><strong>Bedingungen:</strong> {validityRule}</p>}
        </div>
        {invitation.status === 'PENDING' ? (
          <>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3">
              <Checkbox
                checked={policyConfirmed}
                onCheckedChange={(checked) => setPolicyConfirmed(checked === true)}
              />
              <span className="text-sm">
                Ich bestätige die angezeigte Nutzungsrichtlinie. Projektmitgliedschaft und Datenzugriff
                werden erst danach aktiviert.
              </span>
            </label>
            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                disabled={isBusy || !policyConfirmed}
                onClick={() => void decide('accept')}
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />Projekt beitreten
              </Button>
              <Button
                variant="outline"
                disabled={isBusy}
                onClick={() => void decide('reject')}
              >
                <XCircle className="mr-2 h-4 w-4" />Ablehnen
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            Bearbeitet{invitation.respondedAt ? ` am ${formatReceivedAt(invitation.respondedAt)}` : ''}.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function LeistungsanfragenInboxPage() {
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilter>('ALL');
  const [statusFilter, setStatusFilter]     = useState<StatusFilter>('ALL');
  const [coordinationFilter, setCoordinationFilter] = useState<CoordinationFilter>('ALL');
  const [proposalFilter, setProposalFilter] = useState<ProposalFilter>('ALL');
  const [actionOwnerFilter, setActionOwnerFilter] = useState<ActionOwnerFilter>('ALL');
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>('ALL');
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('OPEN');

  const {
    data: requestItemsFromApi,
    isLoading: requestsLoading,
    isError: requestsError,
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
  const {
    data: invitations,
    isLoading: invitationsLoading,
    isError: invitationsError,
    refetch: refetchInvitations,
  } = useListAnProjectInvitations({
    query: {
      queryKey: getListAnProjectInvitationsQueryKey(),
      refetchInterval: 10_000,
      refetchIntervalInBackground: false,
    },
  });

  const allItems = useMemo<InboxItem[]>(() => {
    const requestItems: InboxItem[] = (requestItemsFromApi ?? []).map((data) => ({
      kind: 'service-request',
      data,
      receivedAt: data.createdAt,
      isOpen: !isCompletedRequest(data),
    }));
    const invitationItems: InboxItem[] = (invitations ?? []).map((data) => ({
      kind: 'invitation',
      data,
      receivedAt: data.createdAt,
      isOpen: data.status === 'PENDING',
    }));
    return [...requestItems, ...invitationItems].sort(
      (left, right) => new Date(right.receivedAt).getTime() - new Date(left.receivedAt).getTime(),
    );
  }, [requestItemsFromApi, invitations]);

  const filtered = useMemo(
    () => filterInboxItems(allItems, {
      inboxFilter,
      deadlineFilter,
      statusFilter,
      coordinationFilter,
      proposalFilter,
      actionOwnerFilter,
      scheduleFilter,
    }),
    [allItems, inboxFilter, deadlineFilter, statusFilter, coordinationFilter, proposalFilter, actionOwnerFilter, scheduleFilter],
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (requestsLoading || invitationsLoading) {
    return (
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <Skeleton className="h-8 w-64" />
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (requestsError && invitationsError) {
    return (
      <div className="p-6 max-w-5xl mx-auto flex flex-col items-center gap-4 py-20">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">Fehler beim Laden der Anfragen</p>
        <Button variant="outline" onClick={() => { void refetch(); void refetchInvitations(); }}>
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
        <h1 className="text-2xl font-bold mb-4">Anfragen</h1>
        <div className="flex flex-col items-center justify-center py-24 gap-3 border border-dashed rounded-xl">
          <Inbox className="w-12 h-12 text-muted-foreground opacity-40" />
          <p className="font-medium text-muted-foreground">Keine Anfragen eingegangen</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 p-4 sm:p-6 space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Anfragen</h1>
          <p className="text-muted-foreground text-sm mt-0.5">Einladungen und Leistungsanfragen Ihres Unternehmens</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Live
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={inboxFilter} onValueChange={(v) => setInboxFilter(v as InboxFilter)}>
          <SelectTrigger className="h-8 w-full sm:w-[150px] text-sm">
            <SelectValue placeholder="Ansicht" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPEN">Offen</SelectItem>
            <SelectItem value="ALL">Alle</SelectItem>
            <SelectItem value="DONE">Erledigt</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs font-medium text-muted-foreground sm:ml-2">
          Leistungsanfragen filtern:
        </span>
        <Select value={deadlineFilter} onValueChange={(v) => setDeadlineFilter(v as DeadlineFilter)}>
          <SelectTrigger className="h-8 w-full sm:w-[200px] text-sm">
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
          <SelectTrigger className="h-8 w-full sm:w-[180px] text-sm">
            <SelectValue placeholder="Leistungsstatus" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={coordinationFilter} onValueChange={(v) => setCoordinationFilter(v as CoordinationFilter)}>
          <SelectTrigger className="h-8 w-full sm:w-[180px] text-sm"><SelectValue placeholder="Koordination" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Koordination</SelectItem>
            <SelectItem value="AGREED">Vereinbart</SelectItem>
            <SelectItem value="NO_AGREEMENT">Keine Vereinbarung</SelectItem>
            <SelectItem value="AG_ACTION_REQUIRED">AG muss handeln</SelectItem>
            <SelectItem value="AN_ACTION_REQUIRED">AN muss handeln</SelectItem>
          </SelectContent>
        </Select>
        <Select value={proposalFilter} onValueChange={(v) => setProposalFilter(v as ProposalFilter)}>
          <SelectTrigger className="h-8 w-full sm:w-[170px] text-sm"><SelectValue placeholder="Vorschlag" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Vorschläge</SelectItem>
            <SelectItem value="OPEN">Offener Vorschlag</SelectItem>
            <SelectItem value="NONE">Kein offener Vorschlag</SelectItem>
          </SelectContent>
        </Select>
        <Select value={actionOwnerFilter} onValueChange={(v) => setActionOwnerFilter(v as ActionOwnerFilter)}>
          <SelectTrigger className="h-8 w-full sm:w-[170px] text-sm"><SelectValue placeholder="Nächste Aktion" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle nächsten Aktionen</SelectItem>
            <SelectItem value="AG">AG ist am Zug</SelectItem>
            <SelectItem value="AN">AN ist am Zug</SelectItem>
            <SelectItem value="NONE">Keine Aktion offen</SelectItem>
          </SelectContent>
        </Select>
        <Select value={scheduleFilter} onValueChange={(v) => setScheduleFilter(v as ScheduleFilter)}>
          <SelectTrigger className="h-8 w-full sm:w-[170px] text-sm"><SelectValue placeholder="Terminänderung" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Terminstände</SelectItem>
            <SelectItem value="CHANGED">Mit Terminänderung</SelectItem>
            <SelectItem value="UNCHANGED">Ohne Terminänderung</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {requestsError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <span>Leistungsanfragen konnten nicht geladen werden.</span>
          <Button variant="ghost" size="sm" onClick={() => void refetch()}>Erneut laden</Button>
        </div>
      )}
      {invitationsError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          <span>Projekteinladungen konnten nicht geladen werden.</span>
          <Button variant="ghost" size="sm" onClick={() => void refetchInvitations()}>Erneut laden</Button>
        </div>
      )}

      {/* Inbox cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-10 text-center text-muted-foreground">
          Keine Anfragen für diese Filter
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filtered.map((item) => {
            if (item.kind === 'invitation') {
              return <ProjectInvitationCard key={`invitation-${item.data.id}`} invitation={item.data} />;
            }

            const request = item.data;
            const isExpired = request.status === 'EXPIRED' || !!request.expiredAt;
            const respond = canRespond(request);
            const remCount = request.reminderCount;
            const agOrgName = (request as any).agOrgName as string | null | undefined;
            const zone = (request as any).zone as string | null | undefined;
            const gewerk = (request as any).gewerk as string | null | undefined;

            return (
              <article
                key={`request-${request.id}`}
                className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm transition-colors hover:border-primary/50 hover:bg-muted/20 ${isExpired ? 'opacity-60' : ''}`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={request.requestNumber}>
                      {request.requestNumber}
                    </p>
                    <StatusBadge status={request.status} />
                  </div>
                  <Badge variant="outline" className="w-fit">Leistungsanfrage</Badge>
                  <div className="min-w-0">
                    <Link
                      href={`/leistungsanfragen/${request.id}`}
                      className="block line-clamp-2 text-lg font-semibold leading-tight hover:text-primary"
                      title={request.taktBezeichnung ?? undefined}
                    >
                      {request.taktBezeichnung ?? 'Leistungsanfrage'}
                    </Link>
                    <p className="mt-1 truncate text-sm text-muted-foreground" title={agOrgName ?? undefined}>
                      {agOrgName ?? 'Auftraggeber nicht angegeben'}
                    </p>
                  </div>
                </div>

                {(zone || gewerk) && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {[zone, gewerk].filter(Boolean).map((value) => (
                      <span key={value} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                        {value}
                      </span>
                    ))}
                  </div>
                )}

                {request.openProposal && (
                  <div className="mt-3 rounded-lg bg-orange-500/10 px-3 py-2 text-xs font-medium text-orange-600">
                    Offener Vorschlag · {request.nextActionOwner === 'AN' ? 'Sie sind am Zug' : 'AG ist am Zug'}
                  </div>
                )}

                <div className="mt-4 grid grid-cols-1 gap-4 border-y border-border/70 py-4 sm:grid-cols-2 sm:gap-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Antwortfrist</p>
                    <p className="mt-1 text-sm font-semibold">
                      {request.responseRequiredBy
                        ? format(new Date(request.responseRequiredBy), 'dd.MM.yy HH:mm', { locale: de })
                        : 'Keine'}
                    </p>
                    <div className="mt-1">
                      <DeadlineBadge item={request} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Vereinbarung</p>
                    <p className="mt-1 text-sm font-semibold">
                      {request.currentAgreement
                        ? `${format(new Date(request.currentAgreement.start), 'dd.MM.yy')}–${format(new Date(request.currentAgreement.end), 'dd.MM.yy')}`
                        : 'Noch keine'}
                    </p>
                    {request.scheduleDelta.hasChange && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Δ {request.scheduleDelta.startDays > 0 ? '+' : ''}{request.scheduleDelta.startDays}/
                        {request.scheduleDelta.endDays > 0 ? '+' : ''}{request.scheduleDelta.endDays} Tage
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-auto flex min-w-0 flex-col-reverse items-stretch gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex items-center gap-3 text-xs text-muted-foreground">
                    {typeof remCount === 'number' && remCount > 0 ? (
                      <span className="flex items-center gap-1 text-orange-500">
                        <Bell size={12} aria-hidden />
                        {remCount}× erinnert
                      </span>
                    ) : (
                      <span>Keine Erinnerungen</span>
                    )}
                  </div>
                  {respond ? (
                       <Link href={`/leistungsanfragen/${request.id}`} className="block min-w-0 w-full sm:w-auto sm:shrink-0">
                      <Button size="sm" className="inline-flex max-w-full w-full flex-nowrap whitespace-nowrap gap-1 sm:w-auto">
                        Antworten <ChevronRight size={14} className="shrink-0" />
                      </Button>
                    </Link>
                  ) : isExpired ? (
                    <span
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                      title="Die Antwortfrist und der Ablaufzeitpunkt sind überschritten. Eine reguläre Antwort ist nicht mehr möglich."
                      aria-label="Abgelaufen – Antwort nicht mehr möglich"
                    >
                      <Ban size={14} /> Antwort nicht möglich
                    </span>
                  ) : (
                    <ChevronRight size={16} className="text-muted-foreground/30" aria-hidden />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
         {filtered.length} von {allItems.length} Anfragen
      </p>
    </div>
  );
}
