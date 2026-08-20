/**
 * CoordinationHistory — Task 6.8
 *
 * Shows the full coordination chain: predecessor TaktRequests linked via
 * supersedesRequestId. Loads predecessors lazily when expanded.
 *
 * Each row shows: type (Request/Response/Decision), version, status,
 * timestamp, and a link to open the full detail.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Link } from 'wouter';
import { ChevronDown, ChevronRight, GitMerge, ArrowRight } from 'lucide-react';
import {
  useGetTaktRequestDetail,
  getGetTaktRequestDetailQueryKey,
  type TaktRequestDetail,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ChainEntry {
  kind: 'request' | 'response' | 'decision';
  label: string;
  status: string;
  statusColor: string;
  timestamp: string | null | undefined;
  id?: string;
  requestId?: string;
  note?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function requestStatusColor(status: string): string {
  const map: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    SENT: 'bg-blue-100 text-blue-700',
    DELIVERED: 'bg-blue-100 text-blue-700',
    UNDER_REVIEW: 'bg-amber-100 text-amber-700',
    ACCEPTED: 'bg-emerald-100 text-emerald-700',
    ALTERNATIVES_PROPOSED: 'bg-orange-100 text-orange-700',
    REJECTED: 'bg-red-100 text-red-700',
    REVISION_REQUIRED: 'bg-orange-100 text-orange-700',
    CANCELLED: 'bg-muted text-muted-foreground',
    SUPERSEDED: 'bg-muted text-muted-foreground',
    EXPIRED: 'bg-muted text-muted-foreground',
  };
  return map[status] ?? 'bg-muted text-muted-foreground';
}

function decisionColor(dt: string): string {
  const map: Record<string, string> = {
    CONFIRM_ACCEPTED: 'bg-emerald-100 text-emerald-700',
    ACCEPT_ALTERNATIVE: 'bg-blue-100 text-blue-700',
    REQUEST_REVISION: 'bg-orange-100 text-orange-700',
    CLOSE_WITHOUT_AGREEMENT: 'bg-red-100 text-red-700',
  };
  return map[dt] ?? 'bg-muted text-muted-foreground';
}

type TranslateFn = ReturnType<typeof useTranslation>['t'];

function buildChain(detail: TaktRequestDetail, t: TranslateFn): ChainEntry[] {
  const entries: ChainEntry[] = [];

  // ── Request ─────────────────────────────────────────────────────────────
  entries.push({
    kind: 'request',
    label: `${t('taktRequestDetail.coordinationHistory.request')} ${detail.requestNumber}`,
    status: detail.status,
    statusColor: requestStatusColor(detail.status),
    timestamp: detail.createdAt as unknown as string,
    requestId: detail.id,
    note: detail.supersedesRequestId
      ? t('taktRequestDetail.coordinationHistory.supersedesNote')
      : undefined,
  });

  // ── Response ─────────────────────────────────────────────────────────────
  if (detail.response) {
    const resp = detail.response;
    entries.push({
      kind: 'response',
      label: t('taktRequestDetail.coordinationHistory.response'),
      status: t(
        `taktRequestDetail.response.decisions.${resp.decision}`,
        resp.decision,
      ),
      statusColor:
        resp.decision === 'ACCEPTED'
          ? 'bg-emerald-100 text-emerald-700'
          : resp.decision === 'REJECTED'
          ? 'bg-red-100 text-red-700'
          : 'bg-orange-100 text-orange-700',
      timestamp: resp.createdAt as unknown as string,
    });
  }

  // ── GU Decision ──────────────────────────────────────────────────────────
  if (detail.guDecision) {
    const gd = detail.guDecision;
    entries.push({
      kind: 'decision',
      label: t('taktRequestDetail.coordinationHistory.decision'),
      status: t(
        `taktRequestDetail.guDecision.decisionTypes.${gd.decisionType}`,
        gd.decisionType,
      ),
      statusColor: decisionColor(gd.decisionType),
      timestamp: gd.decidedAt,
    });
  }

  return entries;
}

// ── Predecessor round (recursive) ─────────────────────────────────────────────

function PredecessorRound({
  requestId,
  depth,
}: {
  requestId: string;
  depth: number;
}) {
  const { t } = useTranslation();
  const { data, isLoading } = useGetTaktRequestDetail(requestId, {
    query: {
      queryKey: getGetTaktRequestDetailQueryKey(requestId),
      staleTime: 60_000,
    },
  });

  if (isLoading) {
    return (
      <div className="pl-6 space-y-1.5 py-2">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-40" />
      </div>
    );
  }
  if (!data) return null;

  const chain = buildChain(data, t);

  return (
    <div className={`ml-${Math.min(depth * 4, 12)} border-l-2 border-dashed border-border pl-4 pt-2`}>
      <p className="text-xs font-medium text-muted-foreground mb-2">
        {t('taktRequestDetail.coordinationHistory.previousRound', {
          number: data.requestNumber,
        })}
      </p>
      {chain.map((entry, i) => (
        <ChainRow key={i} entry={entry} isLast={i === chain.length - 1} />
      ))}
      {data.supersedesRequestId && depth < 5 && (
        <PredecessorRound requestId={data.supersedesRequestId} depth={depth + 1} />
      )}
    </div>
  );
}

// ── Chain row ─────────────────────────────────────────────────────────────────

function ChainRow({
  entry,
  isLast,
}: {
  entry: ChainEntry;
  isLast: boolean;
}) {
  return (
    <div className="flex gap-3 group">
      {/* Connector */}
      <div className="flex flex-col items-center">
        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 border-2 border-border bg-background text-muted-foreground group-hover:border-primary/50 transition-colors">
          <div className="w-2 h-2 rounded-full bg-border group-hover:bg-primary/40 transition-colors" />
        </div>
        {!isLast && <div className="w-0.5 flex-1 my-0.5 bg-border" />}
      </div>
      {/* Content */}
      <div className={`pb-3 flex-1 ${isLast ? 'pb-0' : ''}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{entry.label}</span>
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${entry.statusColor}`}
          >
            {entry.status}
          </span>
          {entry.requestId && (
            <Link
              href={`/leistungsanfragen/${entry.requestId}`}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
            >
              <ArrowRight className="w-3 h-3" />
              Öffnen
            </Link>
          )}
        </div>
        {entry.timestamp && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {format(new Date(entry.timestamp), 'dd.MM.yyyy HH:mm')}
          </p>
        )}
        {entry.note && (
          <p className="text-xs text-muted-foreground italic">{entry.note}</p>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface CoordinationHistoryProps {
  detail: TaktRequestDetail;
}

export function CoordinationHistory({ detail }: CoordinationHistoryProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const chain = buildChain(detail, t);
  const hasPredecessors = !!detail.supersedesRequestId;

  return (
    <div className="space-y-3">
      {/* ── Current round chain ─────────────────────────────────────────── */}
      <div className="space-y-0">
        {chain.map((entry, i) => (
          <ChainRow key={i} entry={entry} isLast={i === chain.length - 1 && !hasPredecessors} />
        ))}
      </div>

      {/* ── Predecessor rounds ────────────────────────────────────────────── */}
      {hasPredecessors && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-muted-foreground gap-1 px-1"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
            <GitMerge className="w-3.5 h-3.5" />
            {t('taktRequestDetail.coordinationHistory.showPrevious')}
          </Button>

          {expanded && (
            <PredecessorRound requestId={detail.supersedesRequestId!} depth={1} />
          )}
        </div>
      )}
    </div>
  );
}
