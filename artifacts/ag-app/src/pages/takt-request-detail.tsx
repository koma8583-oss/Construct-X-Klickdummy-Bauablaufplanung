import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'wouter';
import { format, isPast, isAfter, addDays } from 'date-fns';
import {
  useGetTaktRequestDetail,
  getGetTaktRequestDetailQueryKey,
  type TaktRequestDetail,
  type TaktRequestStatus,
  type MessageOutboxStatus,
} from '@workspace/api-client-react';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  RefreshCw,
  Send,
  Ban,
  ArrowRightLeft,
  ChevronRight,
  PlusCircle,
  Lock,
  Loader2,
  FileText,
  Bell,
  Activity,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';

// ── Status badge helpers (reused from list page) ──────────────────────────────

const REQUEST_STATUS_STYLES: Record<string, string> = {
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

const OUTBOX_STATUS_STYLES: Record<string, string> = {
  PENDING:   'text-slate-500 bg-slate-100 border border-slate-200',
  SENT:      'text-indigo-600 bg-indigo-50 border border-indigo-200',
  DELIVERED: 'text-indigo-700 bg-indigo-100 border border-indigo-300',
  READ:      'text-violet-700 bg-violet-100 border border-violet-300',
  FAILED:    'text-red-700 bg-red-100 border border-red-300',
};

function RequestStatusBadge({ status }: { status: TaktRequestStatus }) {
  const { t } = useTranslation();
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium ${REQUEST_STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}
      aria-label={`Anfragestatus: ${status}`}
    >
      {t(`taktRequests.requestStatus.${status}`, status)}
    </span>
  );
}

function OutboxStatusBadge({ status }: { status: MessageOutboxStatus | null | undefined }) {
  const { t } = useTranslation();
  if (!status) {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium bg-background border border-border text-muted-foreground">
        {t('taktRequests.messageStatus.none')}
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm font-medium ${OUTBOX_STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}
      aria-label={`Nachrichtenstatus: ${status}`}
    >
      {status === 'FAILED' && <AlertTriangle className="w-3.5 h-3.5" />}
      {t(`taktRequests.messageStatus.${status}`, status)}
    </span>
  );
}

// ── Deadline display ──────────────────────────────────────────────────────────

function DeadlineDisplay({ date }: { date: string | null | undefined }) {
  const { t } = useTranslation();
  if (!date) return <span className="text-muted-foreground">{t('taktRequestDetail.noDeadline')}</span>;
  const d = new Date(date);
  const overdue = isPast(d);
  const soon = !overdue && isAfter(addDays(new Date(), 3), d);
  return (
    <span className={overdue ? 'text-red-600 font-medium' : soon ? 'text-amber-600' : ''}>
      {overdue && <Clock className="w-3.5 h-3.5 inline mr-1" />}
      {format(d, 'dd.MM.yyyy HH:mm')}
      {overdue && <span className="ml-1.5 text-xs font-normal">({t('taktRequestDetail.overdue')})</span>}
    </span>
  );
}

// ── Process Timeline ──────────────────────────────────────────────────────────

interface TimelineEvent {
  label: string;
  timestamp: string | Date | null | undefined;
  notTracked?: boolean;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const { t } = useTranslation();

  return (
    <div className="space-y-0">
      {events.map((ev, i) => {
        const done = !!ev.timestamp;
        const isLast = i === events.length - 1;
        return (
          <div key={i} className="flex gap-3">
            {/* Connector column */}
            <div className="flex flex-col items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-colors ${
                  done
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'bg-background border-border text-muted-foreground'
                }`}
              >
                {done
                  ? <CheckCircle2 className="w-4 h-4" />
                  : <Circle className="w-4 h-4" />
                }
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 my-1 ${done ? 'bg-primary/30' : 'bg-border'}`} />
              )}
            </div>
            {/* Content */}
            <div className={`pb-4 ${isLast ? 'pb-0' : ''}`}>
              <p className={`text-sm font-medium leading-7 ${done ? 'text-foreground' : 'text-muted-foreground'}`}>
                {ev.label}
              </p>
              {done && ev.timestamp && (
                <p className="text-xs text-muted-foreground">
                  {format(new Date(ev.timestamp as string), 'dd.MM.yyyy HH:mm:ss')}
                </p>
              )}
              {!done && (
                <p className="text-xs text-muted-foreground/60">
                  {ev.notTracked ? t('taktRequestDetail.timeline.notTracked') : t('taktRequestDetail.timeline.pending')}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Snapshot Preview ──────────────────────────────────────────────────────────

function SnapshotPreview({ snapshot }: { snapshot: TaktRequestDetail['snapshot'] }) {
  const { t } = useTranslation();

  if (!snapshot) {
    return (
      <p className="text-sm text-muted-foreground">{t('taktRequestDetail.snapshot.noSnapshot')}</p>
    );
  }

  const p = snapshot.snapshotPayload as Record<string, unknown>;

  // Helper to render any JSON value in a human-readable way
  function renderValue(v: unknown): React.ReactNode {
    if (v === null || v === undefined) return <span className="text-muted-foreground">—</span>;
    if (Array.isArray(v)) {
      if (v.length === 0) return <span className="text-muted-foreground">—</span>;
      return (
        <ul className="list-disc list-inside space-y-0.5">
          {v.map((item, i) => (
            <li key={i} className="text-sm">{typeof item === 'object' ? JSON.stringify(item) : String(item)}</li>
          ))}
        </ul>
      );
    }
    if (typeof v === 'object') {
      return <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto">{JSON.stringify(v, null, 2)}</pre>;
    }
    return <span>{String(v)}</span>;
  }

  const taktWindow = p.taktWindow as Record<string, unknown> | undefined;
  const resources = p.resourceRequirements as unknown[] | undefined;
  const constraints = p.constraints as unknown[] | undefined;
  const docs = p.documentReferences as unknown[] | undefined;

  const rows: Array<{ label: string; value: unknown }> = [
    { label: t('taktRequestDetail.snapshot.schemaVersion'), value: snapshot.schemaVersion },
    { label: t('taktRequestDetail.snapshot.taktVersion'), value: p.taktVersion },
    { label: t('taktRequestDetail.snapshot.timeWindow'), value: taktWindow ? `${taktWindow.start} → ${taktWindow.end}` : (p.plannedStart ? `${p.plannedStart} → ${p.plannedEnd}` : null) },
    { label: t('taktRequestDetail.snapshot.trade'), value: p.gewerk ?? p.trade },
    { label: t('taktRequestDetail.snapshot.workPackage'), value: p.arbeitspaket ?? p.workPackage },
    { label: t('taktRequestDetail.snapshot.location'), value: p.ort ?? p.location ?? p.zone },
    { label: t('taktRequestDetail.snapshot.resourceRequirements'), value: resources },
    { label: t('taktRequestDetail.snapshot.constraints'), value: constraints },
    { label: t('taktRequestDetail.snapshot.documentReferences'), value: docs },
  ];

  return (
    <div className="space-y-3">
      {/* Immutability notice */}
      <div className="flex items-start gap-2 px-3 py-2 rounded-md bg-amber-500/10 border border-amber-500/20">
        <Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-amber-700">{t('taktRequestDetail.snapshot.immutableHint')}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {rows.map(({ label, value }) => {
          if (value === null || value === undefined) return null;
          if (Array.isArray(value) && value.length === 0) return null;
          return (
            <React.Fragment key={label}>
              <dt className="text-sm font-medium text-muted-foreground whitespace-nowrap">{label}</dt>
              <dd className="text-sm text-foreground">{renderValue(value)}</dd>
            </React.Fragment>
          );
        })}
      </dl>
    </div>
  );
}

// ── Notification Preview ──────────────────────────────────────────────────────

function NotificationPreview({ detail }: { detail: TaktRequestDetail }) {
  const { t } = useTranslation();
  const np = detail.transport.notificationPayload;

  if (!np) {
    return <p className="text-sm text-muted-foreground">{t('taktRequestDetail.notification.noNotification')}</p>;
  }

  const rows: Array<{ label: string; value: unknown }> = [
    { label: t('taktRequestDetail.notification.subject'), value: np.subject },
    { label: t('taktRequestDetail.notification.message'), value: np.message },
    { label: t('taktRequestDetail.notification.projectRef'), value: np.projectReference },
    { label: t('taktRequestDetail.notification.taktRef'), value: np.taktReference },
    { label: t('taktRequestDetail.notification.responseRequiredBy'), value: np.responseRequiredBy ? format(new Date(np.responseRequiredBy as string), 'dd.MM.yyyy HH:mm') : null },
    { label: t('taktRequestDetail.notification.detailsRef'), value: np.detailsRef },
  ];

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      {rows.map(({ label, value }) => {
        if (value === null || value === undefined || value === '') return null;
        return (
          <React.Fragment key={label}>
            <dt className="text-sm font-medium text-muted-foreground whitespace-nowrap">{label}</dt>
            <dd className="text-sm text-foreground font-mono break-all">{String(value)}</dd>
          </React.Fragment>
        );
      })}
    </dl>
  );
}

// ── Transport Error Panel ─────────────────────────────────────────────────────

function TransportErrorPanel({ detail }: { detail: TaktRequestDetail }) {
  const { t } = useTranslation();
  const tr = detail.transport;
  if (tr.status !== 'FAILED') return null;

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-4 space-y-3">
      <div className="flex items-center gap-2 text-red-700 font-semibold">
        <AlertTriangle className="w-4 h-4" />
        {t('taktRequestDetail.transport.failedTitle')}
      </div>
      <dl className="space-y-1.5">
        {tr.failureReason && (
          <>
            <dt className="text-xs font-medium text-red-600">{t('taktRequestDetail.transport.failureReason')}</dt>
            <dd className="text-sm text-red-700 bg-white/60 rounded px-2 py-1">{tr.failureReason}</dd>
          </>
        )}
        <div className="flex gap-6 pt-1">
          <div>
            <dt className="text-xs font-medium text-red-600">{t('taktRequestDetail.transport.attemptCount')}</dt>
            <dd className="text-sm text-red-700">{tr.attemptCount ?? '—'}</dd>
          </div>
          {tr.lastAttemptAt && (
            <div>
              <dt className="text-xs font-medium text-red-600">{t('taktRequestDetail.transport.lastAttempt')}</dt>
              <dd className="text-sm text-red-700">{format(new Date(tr.lastAttemptAt as unknown as string), 'dd.MM.yyyy HH:mm:ss')}</dd>
            </div>
          )}
        </div>
      </dl>
    </div>
  );
}

// ── Response Panel ────────────────────────────────────────────────────────────

function ResponsePanel({ detail }: { detail: TaktRequestDetail }) {
  const { t } = useTranslation();
  const resp = detail.response;

  if (!resp) {
    return <p className="text-sm text-muted-foreground">{t('taktRequestDetail.response.noResponse')}</p>;
  }

  const decisionStyles: Record<string, string> = {
    ACCEPTED:              'text-emerald-700 bg-emerald-50 border border-emerald-200',
    ALTERNATIVES_PROPOSED: 'text-orange-700 bg-orange-50 border border-orange-200',
    REJECTED:              'text-red-700 bg-red-50 border border-red-200',
  };

  return (
    <div className="space-y-4">
      {/* Decision badge */}
      <div className="flex items-center gap-3">
        <span className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${decisionStyles[resp.decision] ?? ''}`}>
          {t(`taktRequestDetail.response.decisions.${resp.decision}`, resp.decision)}
        </span>
        <span className="text-xs text-muted-foreground">
          {format(new Date(resp.createdAt as unknown as string), 'dd.MM.yyyy HH:mm')}
        </span>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        {resp.reasonCode && (
          <>
            <dt className="text-sm font-medium text-muted-foreground">{t('taktRequestDetail.response.reasonCode')}</dt>
            <dd className="text-sm">{t(`taktRequestDetail.response.reasonCodes.${resp.reasonCode}`, resp.reasonCode)}</dd>
          </>
        )}
        {resp.comment && (
          <>
            <dt className="text-sm font-medium text-muted-foreground">{t('taktRequestDetail.response.comment')}</dt>
            <dd className="text-sm">{resp.comment}</dd>
          </>
        )}
        {resp.decision === 'ACCEPTED' && resp.acceptedStart && resp.acceptedEnd && (
          <>
            <dt className="text-sm font-medium text-muted-foreground">{t('taktRequestDetail.response.acceptedWindow')}</dt>
            <dd className="text-sm">
              {format(new Date(resp.acceptedStart as unknown as string), 'dd.MM.yyyy HH:mm')} – {format(new Date(resp.acceptedEnd as unknown as string), 'dd.MM.yyyy HH:mm')}
            </dd>
          </>
        )}
        {resp.nextAvailableDate && (
          <>
            <dt className="text-sm font-medium text-muted-foreground">{t('taktRequestDetail.response.nextAvailableDate')}</dt>
            <dd className="text-sm">{resp.nextAvailableDate}</dd>
          </>
        )}
      </dl>

      {/* Alternatives */}
      {resp.alternatives && resp.alternatives.length > 0 && (
        <div>
          <p className="text-sm font-medium mb-2">{t('taktRequestDetail.response.alternatives')}</p>
          <div className="space-y-2">
            {resp.alternatives.map((alt) => (
              <div key={alt.alternativeId} className="border border-border rounded-md p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Badge variant="outline" className="text-xs">#{alt.rank}</Badge>
                  <span className="font-medium text-xs text-muted-foreground">{alt.alternativeId}</span>
                </div>
                <p>
                  {format(new Date(alt.proposedStart as unknown as string), 'dd.MM.yy HH:mm')} – {format(new Date(alt.proposedEnd as unknown as string), 'dd.MM.yy HH:mm')}
                  {alt.crewSize && <span className="ml-2 text-muted-foreground">({alt.crewSize} Pers.)</span>}
                </p>
                {alt.conditions && alt.conditions.length > 0 && (
                  <ul className="mt-1 list-disc list-inside text-muted-foreground">
                    {alt.conditions.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Actions panel ─────────────────────────────────────────────────────────────

const OPEN_STATUSES = new Set<TaktRequestStatus>([
  'DRAFT', 'SENT', 'DELIVERED', 'DETAILS_RETRIEVED',
  'UNDER_REVIEW', 'ALTERNATIVES_PROPOSED', 'REVISION_REQUIRED',
]);

const CLOSED_STATUSES = new Set<TaktRequestStatus>([
  'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED',
]);

function ActionsPanel({ detail }: { detail: TaktRequestDetail }) {
  const { t } = useTranslation();
  const { status } = detail;
  const outboxFailed = detail.transport.status === 'FAILED';
  const hasResponse = !!detail.response;

  const actions: React.ReactNode[] = [];

  if (status === 'DRAFT') {
    actions.push(
      <Button key="send" size="default">
        <Send className="w-4 h-4 mr-2" />
        {t('taktRequestDetail.actions.send')}
      </Button>,
    );
  }

  if (outboxFailed) {
    actions.push(
      <Button key="resend" variant="outline">
        <RefreshCw className="w-4 h-4 mr-2" />
        {t('taktRequestDetail.actions.resend')}
      </Button>,
    );
  }

  if (hasResponse || status === 'ALTERNATIVES_PROPOSED') {
    actions.push(
      <Button key="response" variant="outline">
        <ChevronRight className="w-4 h-4 mr-2" />
        {t('taktRequestDetail.actions.viewResponse')}
      </Button>,
    );
  }

  if (OPEN_STATUSES.has(status) && status !== 'DRAFT') {
    actions.push(
      <Button key="cancel" variant="outline" className="text-destructive hover:text-destructive">
        <Ban className="w-4 h-4 mr-2" />
        {t('taktRequestDetail.actions.cancel')}
      </Button>,
    );
  }

  if (CLOSED_STATUSES.has(status) && status !== 'CANCELLED') {
    /* "Neue Version erstellen" — backend not yet implemented; show as disabled with tooltip */
    actions.push(
      <div key="newversion" className="flex flex-col gap-1">
        <Button variant="outline" disabled>
          <PlusCircle className="w-4 h-4 mr-2" />
          {t('taktRequestDetail.actions.newVersion')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('taktRequestDetail.actions.newVersionHint')}</p>
      </div>,
    );
  }

  if (actions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 items-start">
      {actions}
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <Separator />
      {children}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function TaktRequestDetailPage() {
  const { t } = useTranslation();
  const { requestId } = useParams<{ requestId: string }>();

  const {
    data: detail,
    isLoading,
    isError,
    refetch,
  } = useGetTaktRequestDetail(requestId ?? '', {
    query: {
      queryKey: getGetTaktRequestDetailQueryKey(requestId ?? ''),
      enabled: !!requestId,
    },
  });

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-2 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Skeleton key={i} className="h-12" />)}
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError || !detail) {
    return (
      <div className="p-6 max-w-4xl mx-auto flex flex-col items-center justify-center py-20 gap-4">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">
          {isError ? t('taktRequestDetail.error') : t('taktRequestDetail.notFound')}
        </p>
        {isError && (
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('taktRequestDetail.retry')}
          </Button>
        )}
        <Link href="/takt-requests" className="text-sm text-muted-foreground hover:underline">
          ← {t('taktRequestDetail.back')}
        </Link>
      </div>
    );
  }

  // ── Build timeline events ─────────────────────────────────────────────────
  const tl = detail.timeline;
  const timelineEvents: TimelineEvent[] = [
    { label: t('taktRequestDetail.timeline.requestCreated'), timestamp: tl.requestCreatedAt },
    { label: t('taktRequestDetail.timeline.snapshotCreated'), timestamp: tl.snapshotCreatedAt },
    { label: t('taktRequestDetail.timeline.messageSent'), timestamp: tl.sentAt },
    { label: t('taktRequestDetail.timeline.messageDelivered'), timestamp: tl.deliveredAt },
    { label: t('taktRequestDetail.timeline.messageRead'), timestamp: tl.inboxReadAt },
    { label: t('taktRequestDetail.timeline.detailsRetrieved'), timestamp: tl.detailsRetrievedAt },
    { label: t('taktRequestDetail.timeline.reviewStarted'), timestamp: tl.checkedAt, notTracked: tl.checkedAt === null },
    { label: t('taktRequestDetail.timeline.responseReceived'), timestamp: tl.responseCreatedAt },
    { label: t('taktRequestDetail.timeline.decisionMade'), timestamp: tl.responseCreatedAt },
  ];

  const outboxFailed = detail.transport.status === 'FAILED';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Back link */}
      <Link href="/takt-requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="w-3.5 h-3.5" />
        {t('taktRequestDetail.back')}
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold">{t('taktRequestDetail.title')}</h1>
            <span className="font-mono text-muted-foreground text-lg">{detail.requestNumber}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <RequestStatusBadge status={detail.status as TaktRequestStatus} />
            <OutboxStatusBadge status={(detail.transport.status as MessageOutboxStatus) ?? null} />
            {outboxFailed && (
              <span className="text-xs text-red-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                Zustellfehler
              </span>
            )}
            {OPEN_STATUSES.has(detail.status as TaktRequestStatus) && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Live
              </span>
            )}
          </div>
        </div>
        <ActionsPanel detail={detail} />
      </div>

      {/* Transport Error Panel */}
      {outboxFailed && <TransportErrorPanel detail={detail} />}

      {/* Metadata grid */}
      <div className="rounded-xl border border-border bg-card p-5">
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
          {[
            { label: t('taktRequestDetail.header.project'), value: detail.projectName },
            { label: t('taktRequestDetail.header.takt'), value: detail.taktBezeichnung },
            { label: t('taktRequestDetail.header.version'), value: `v${detail.taktVersion}` },
            { label: t('taktRequestDetail.header.contractor'), value: detail.nuOrgName },
            {
              label: t('taktRequestDetail.header.deadline'),
              value: <DeadlineDisplay date={detail.responseRequiredBy ?? null} />,
            },
            {
              label: t('taktRequestDetail.header.requestStatus'),
              value: <RequestStatusBadge status={detail.status as TaktRequestStatus} />,
            },
            {
              label: t('taktRequestDetail.header.messageStatus'),
              value: <OutboxStatusBadge status={(detail.transport.status as MessageOutboxStatus) ?? null} />,
            },
          ].map(({ label, value }) => (
            <div key={label}>
              <dt className="text-xs font-medium text-muted-foreground mb-0.5">{label}</dt>
              <dd className="text-sm text-foreground">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Two-column layout for timeline + content */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        {/* Timeline */}
        <Section icon={<Activity className="w-4 h-4" />} title={t('taktRequestDetail.timeline.title')}>
          <Timeline events={timelineEvents} />
        </Section>

        {/* Right column: snapshot + notification + response */}
        <div className="space-y-6">
          {/* Snapshot */}
          <Section icon={<Lock className="w-4 h-4" />} title={t('taktRequestDetail.snapshot.title')}>
            <SnapshotPreview snapshot={detail.snapshot ?? null} />
          </Section>

          {/* Notification (separate from snapshot) */}
          <Section icon={<Bell className="w-4 h-4" />} title={t('taktRequestDetail.notification.title')}>
            <NotificationPreview detail={detail} />
          </Section>

          {/* Response */}
          <Section icon={<FileText className="w-4 h-4" />} title={t('taktRequestDetail.response.title')}>
            <ResponsePanel detail={detail} />
          </Section>
        </div>
      </div>
    </div>
  );
}
