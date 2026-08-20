/**
 * Vorschläge (Gegenvorschläge) für ein Projekt
 *
 * Zeigt alle TaktAnfragen mit Status ALTERNATIVES_PROPOSED für das gewählte Projekt.
 * Die GU-Entscheidung (Annehmen / Alternative wählen / Revision / Schliessen) erfolgt
 * auf der jeweiligen Anfrage-Detailseite, die hier verlinkt ist.
 */

import React, { useMemo } from 'react';
import { useParams, Link } from 'wouter';
import { format, isPast } from 'date-fns';
import {
  useListTaktRequests,
  getListTaktRequestsQueryKey,
  type TaktRequestListItem,
} from '@workspace/api-client-react';
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  Calendar,
  ChevronRight,
  Clock,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { DeadlineStatusBadge } from '@/components/deadline-status-badge';

export default function ProjectProposals() {
  const { projectId } = useParams<{ projectId: string }>();

  const { data: allRequests, isLoading, isError, refetch } = useListTaktRequests(
    { status: 'ALTERNATIVES_PROPOSED' },
    {
      query: {
        enabled: !!projectId,
        queryKey: getListTaktRequestsQueryKey({ status: 'ALTERNATIVES_PROPOSED' }),
        refetchInterval: 20_000,
        refetchIntervalInBackground: false,
      },
    },
  );

  // Filter to this project's requests
  const proposals = useMemo(
    () => (allRequests ?? []).filter((r) => r.projectId === projectId),
    [allRequests, projectId],
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/projects/${projectId}`}>
          <Button variant="outline" size="icon" className="h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-orange-500" />
            Gegenvorschläge
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Offene Termingegenvorschläge des Nachunternehmens – Entscheidung erforderlich
          </p>
        </div>
        {!isLoading && proposals.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-shrink-0">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Live
          </div>
        )}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 border border-dashed rounded-xl">
          <p className="text-muted-foreground text-sm">Anfragen konnten nicht geladen werden.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5 mr-2" />
            Erneut versuchen
          </Button>
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && proposals.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-3 border border-dashed rounded-xl">
          <ArrowRightLeft className="w-10 h-10 text-muted-foreground opacity-30" />
          <p className="font-medium text-muted-foreground">Keine offenen Gegenvorschläge</p>
          <p className="text-sm text-muted-foreground/70">
            Sobald ein Nachunternehmen einen Gegenvorschlag einreicht, erscheint er hier.
          </p>
        </div>
      )}

      {/* Proposal cards */}
      {!isLoading && !isError && proposals.length > 0 && (
        <div className="space-y-3">
          {proposals.map((item) => (
            <ProposalCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ProposalCard({ item }: { item: TaktRequestListItem }) {
  const deadline = (item as any).guDecisionRequiredBy ?? (item as any).responseRequiredBy ?? null;
  const overdue = deadline ? isPast(new Date(deadline)) : false;

  return (
    <div className={`rounded-xl border bg-card overflow-hidden transition-shadow hover:shadow-md ${overdue ? 'border-orange-400/60' : 'border-border'}`}>
      {overdue && (
        <div className="bg-orange-500/10 border-b border-orange-400/30 px-4 py-1.5 flex items-center gap-2 text-xs font-semibold text-orange-700">
          <Clock className="w-3.5 h-3.5" />
          Entscheidungsfrist abgelaufen — sofortige Aktion erforderlich
        </div>
      )}

      <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4">
        {/* Info */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Top row: status pill + takt name */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-orange-600 bg-orange-500/10 flex-shrink-0">
              <ArrowRightLeft className="w-3 h-3" />
              Gegenvorschlag
            </span>
            <span className="font-semibold text-sm truncate">{item.taktBezeichnung}</span>
            <span className="text-xs text-muted-foreground font-mono">{item.requestNumber}</span>
          </div>

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Building2 className="w-3 h-3 opacity-60" />
              {item.nuOrgName}
            </span>
            {deadline && (
              <span className={`flex items-center gap-1 ${overdue ? 'text-orange-600 font-semibold' : ''}`}>
                <Calendar className="w-3 h-3 opacity-60" />
                Frist: {format(new Date(deadline), 'dd.MM.yyyy HH:mm')}
              </span>
            )}
          </div>

          {/* Deadline badge */}
          <DeadlineStatusBadge
            responseRequiredBy={(item as any).responseRequiredBy}
            expiresAt={(item as any).expiresAt}
            expiredAt={(item as any).expiredAt}
            guDecisionRequiredBy={(item as any).guDecisionRequiredBy}
          />
        </div>

        {/* Action */}
        <Link href={`/leistungsanfragen/${item.id}`}>
          <Button className="shrink-0 w-full sm:w-auto">
            <ChevronRight className="w-4 h-4 mr-2" />
            Entscheidung treffen
          </Button>
        </Link>
      </div>
    </div>
  );
}
