import React, { useState, useMemo } from 'react';
import { format } from 'date-fns';
import {
  useListOrganizations,
  useListDelegations,
  getListOrganizationsQueryKey,
  getListDelegationsQueryKey,
  type Organization,
  type DelegationStatus,
} from '@workspace/api-client-react';
import {
  Users, Search, Mail, Building2, CheckCircle, Clock,
  XCircle, ChevronRight, Inbox, AlertCircle, ArrowRightLeft,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<DelegationStatus, string> = {
  PENDING:              'Ausstehend',
  CONFIRMED:            'Bestätigt',
  ALTERNATIVE_PROPOSED: 'Gegenvorschlag',
  REJECTED:             'Abgelehnt',
  CANCELLED:            'Storniert',
};

const STATUS_COLOR: Record<DelegationStatus, string> = {
  PENDING:              'text-amber-500 bg-amber-500/10',
  CONFIRMED:            'text-emerald-500 bg-emerald-500/10',
  ALTERNATIVE_PROPOSED: 'text-blue-500 bg-blue-500/10',
  REJECTED:             'text-red-500 bg-red-500/10',
  CANCELLED:            'text-muted-foreground bg-muted/40',
};

const STATUS_ICON: Record<DelegationStatus, React.ReactNode> = {
  PENDING:              <Clock className="w-3.5 h-3.5" />,
  CONFIRMED:            <CheckCircle className="w-3.5 h-3.5" />,
  ALTERNATIVE_PROPOSED: <ArrowRightLeft className="w-3.5 h-3.5" />,
  REJECTED:             <XCircle className="w-3.5 h-3.5" />,
  CANCELLED:            <XCircle className="w-3.5 h-3.5" />,
};

function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');
}

// ── Contractor list item ───────────────────────────────────────────────────────

function ContractorItem({
  contractor,
  isSelected,
  onClick,
  activeDelegations,
}: {
  contractor: Organization;
  isSelected: boolean;
  onClick: () => void;
  activeDelegations: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors
        ${isSelected
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'hover:bg-sidebar-accent/50 text-sidebar-foreground'
        }`}
    >
      <div className="w-8 h-8 rounded-md bg-primary/15 flex items-center justify-center text-primary font-bold text-xs shrink-0">
        {initials(contractor.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{contractor.name}</div>
        {contractor.contactEmail && (
          <div className="text-[11px] text-muted-foreground truncate">{contractor.contactEmail}</div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {activeDelegations > 0 && (
          <span className="text-[10px] font-semibold bg-primary/15 text-primary rounded-full px-1.5 py-0.5">
            {activeDelegations}
          </span>
        )}
        <ChevronRight className={`w-3.5 h-3.5 transition-opacity ${isSelected ? 'opacity-70' : 'opacity-30'}`} />
      </div>
    </button>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function ContractorDetail({ contractor }: { contractor: Organization }) {
  const { data: delegations, isLoading } = useListDelegations(
    { anOrgId: contractor.id },
    { query: { queryKey: getListDelegationsQueryKey({ anOrgId: contractor.id }) } },
  );

  const activeDelegations = useMemo(
    () => delegations?.filter(d => d.status !== 'CANCELLED') ?? [],
    [delegations],
  );

  const byStatus = useMemo(() => {
    const map: Partial<Record<DelegationStatus, number>> = {};
    for (const d of activeDelegations) {
      map[d.status] = (map[d.status] ?? 0) + 1;
    }
    return map;
  }, [activeDelegations]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border px-6 py-5">
        <div className="flex items-center gap-4 mb-3">
          <div className="w-12 h-12 rounded-lg bg-primary/15 flex items-center justify-center text-primary font-bold text-lg shrink-0">
            {initials(contractor.name)}
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">{contractor.name}</h2>
            <div className="flex items-center gap-3 mt-1">
              <Badge variant="outline" className="text-[10px] font-mono">
                AN · {contractor.id.substring(0, 8)}
              </Badge>
            </div>
          </div>
        </div>

        {/* Contact row */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          {contractor.contactEmail ? (
            <a
              href={`mailto:${contractor.contactEmail}`}
              className="flex items-center gap-1.5 hover:text-primary transition-colors"
            >
              <Mail className="w-3.5 h-3.5" />
              {contractor.contactEmail}
            </a>
          ) : (
            <span className="flex items-center gap-1.5 italic opacity-50">
              <Mail className="w-3.5 h-3.5" />
              Keine E-Mail hinterlegt
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Building2 className="w-3.5 h-3.5" />
            Nachunternehmer (AN)
          </span>
        </div>

        {contractor.description && (
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            {contractor.description}
          </p>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border">
        {(
          [
            ['PENDING', 'Ausstehend'],
            ['CONFIRMED', 'Bestätigt'],
            ['ALTERNATIVE_PROPOSED', 'Gegenvorschlag'],
            ['REJECTED', 'Abgelehnt'],
          ] as [DelegationStatus, string][]
        ).map(([status, label]) => (
          <div key={status} className="px-4 py-3 text-center">
            <div className={`text-2xl font-bold ${byStatus[status] ? 'text-foreground' : 'text-muted-foreground/40'}`}>
              {byStatus[status] ?? 0}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{label}</div>
          </div>
        ))}
      </div>

      {/* Delegation list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Aktive Vergaben
        </h3>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : activeDelegations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Inbox className="w-10 h-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Keine aktiven Vergaben</p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeDelegations
              .slice()
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
              .map(d => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/60 bg-card hover:border-border transition-colors"
                >
                  <span className={`flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full shrink-0 ${STATUS_COLOR[d.status]}`}>
                    {STATUS_ICON[d.status]}
                    {STATUS_LABEL[d.status]}
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {d.takt?.taktBezeichnung ?? '–'}
                      {d.takt?.gewerk && (
                        <span className="text-muted-foreground font-normal"> · {d.takt.gewerk}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {format(new Date(d.requestedStart), 'dd.MM.yyyy')} – {format(new Date(d.requestedEnd), 'dd.MM.yyyy')}
                    </div>
                  </div>

                  <div className="text-[11px] text-muted-foreground shrink-0">
                    {format(new Date(d.createdAt), 'dd.MM.yy')}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Contractors() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: contractors, isLoading } = useListOrganizations(
    { type: 'AN' },
    { query: { queryKey: getListOrganizationsQueryKey({ type: 'AN' }) } },
  );

  // Active delegations for all contractors (for list badge counts)
  const { data: allDelegations } = useListDelegations(
    {},
    { query: { queryKey: getListDelegationsQueryKey({}) } },
  );

  const activeDelegationsByAnOrg = useMemo(() => {
    const map: Record<string, number> = {};
    for (const d of allDelegations ?? []) {
      if (d.status !== 'CANCELLED') {
        map[d.anOrgId] = (map[d.anOrgId] ?? 0) + 1;
      }
    }
    return map;
  }, [allDelegations]);

  const filtered = useMemo(
    () =>
      contractors?.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.contactEmail && c.contactEmail.toLowerCase().includes(search.toLowerCase())) ||
        (c.description && c.description.toLowerCase().includes(search.toLowerCase())),
      ) ?? [],
    [contractors, search],
  );

  const selectedContractor = useMemo(
    () => contractors?.find(c => c.id === selectedId) ?? null,
    [contractors, selectedId],
  );

  return (
    <div className="-m-8 h-[calc(100vh-3.5rem)] flex overflow-hidden">
      {/* ── Left sidebar ───────────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-border flex flex-col bg-sidebar overflow-hidden">
        {/* Header */}
        <div className="px-4 pt-5 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-primary" />
            <h1 className="font-semibold text-sm">Nachunternehmer</h1>
            {contractors && (
              <span className="ml-auto text-[11px] text-muted-foreground">{contractors.length}</span>
            )}
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Suchen…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm bg-background"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-lg mx-1" />
            ))
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground px-3">
              {search ? 'Kein Treffer.' : 'Noch keine Nachunternehmer vorhanden.'}
            </div>
          ) : (
            filtered.map(c => (
              <ContractorItem
                key={c.id}
                contractor={c}
                isSelected={c.id === selectedId}
                onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                activeDelegations={activeDelegationsByAnOrg[c.id] ?? 0}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Right detail panel ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden bg-background">
        {selectedContractor ? (
          <ContractorDetail contractor={selectedContractor} />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-muted-foreground/50" />
            </div>
            <h3 className="font-medium text-lg">Nachunternehmer auswählen</h3>
            <p className="text-muted-foreground text-sm max-w-xs mt-1">
              Wählen Sie links einen Nachunternehmer aus, um seine Vergaben und Kontaktdaten einzusehen.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
