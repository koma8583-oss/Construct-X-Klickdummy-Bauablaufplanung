import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  useGetAgProjectsOverview,
  getGetAgProjectsOverviewQueryKey,
  useCreateProject,
  getListProjectsQueryKey,
  AgProjectSummary,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Plus,
  Search,
  Briefcase,
  Calendar,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ChevronRight,
  ArrowUpDown,
  Filter,
  RefreshCw,
  MapPin,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

// ── Status helpers ──────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  ACTIVE:    'Aktiv',
  COMPLETED: 'Abgeschlossen',
  ARCHIVED:  'Archiviert',
  DRAFT:     'Entwurf',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  ACTIVE:    'default',
  COMPLETED: 'secondary',
  ARCHIVED:  'outline',
  DRAFT:     'outline',
};

function fmt(date?: string | null): string {
  if (!date) return '—';
  try { return format(parseISO(date), 'dd.MM.yyyy'); } catch { return date; }
}

function fmtRelative(date?: string | null): string {
  if (!date) return '—';
  try {
    return formatDistanceToNow(parseISO(date), { addSuffix: true, locale: de });
  } catch { return date; }
}

// ── Aggregate KPI strip ────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: number | string;
  warn?: boolean;
  highlight?: boolean;
}

function KpiCard({ label, value, warn, highlight }: KpiCardProps) {
  return (
    <Card className={`bg-card flex-1 min-w-[130px] ${warn ? 'border-red-500/40' : ''}`}>
      <CardContent className="p-4">
        <div className={`text-xs font-semibold uppercase tracking-wider mb-1 ${warn ? 'text-red-500' : 'text-muted-foreground'}`}>
          {label}
        </div>
        <div className={`text-2xl font-bold tabular-nums ${warn ? 'text-red-500' : highlight ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sort + filter types ────────────────────────────────────────────────────────

type SortKey = 'name' | 'lastActivity' | 'openRequests' | 'overdueRequests';
type StatusFilter = 'ALL' | 'ACTIVE' | 'COMPLETED' | 'ARCHIVED';

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Projects() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Filters + sort
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('lastActivity');

  // Create dialog
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const { data: projects, isLoading, isError, refetch } = useGetAgProjectsOverview();
  const createProject = useCreateProject();

  // ── Aggregated KPIs ──────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    if (!projects) return null;
    return {
      total:       projects.length,
      active:      projects.filter(p => p.projectStatus === 'ACTIVE').length,
      openTotal:   projects.reduce((s, p) => s + (p.openTaktRequests ?? 0), 0),
      overdueTotal:projects.reduce((s, p) => s + (p.overdueTaktRequests ?? 0), 0),
      accepted:    projects.reduce((s, p) => s + (p.acceptedTaktRequests ?? 0), 0),
      anTotal:     projects.reduce((s, p) => s + (p.assignedAnCount ?? 0), 0),
    };
  }, [projects]);

  // ── Filtered + sorted ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!projects) return [];
    let result = [...projects];

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(p =>
        p.projectName.toLowerCase().includes(q) ||
        (p.assignedTrades ?? []).some((tr: string) => tr.toLowerCase().includes(q)),
      );
    }

    if (statusFilter !== 'ALL') {
      result = result.filter(p => p.projectStatus === statusFilter);
    }

    if (onlyOpen) {
      result = result.filter(p => (p.openTaktRequests ?? 0) > 0);
    }

    if (onlyOverdue) {
      result = result.filter(p => (p.overdueTaktRequests ?? 0) > 0);
    }

    result.sort((a, b) => {
      switch (sortKey) {
        case 'name':           return a.projectName.localeCompare(b.projectName, 'de');
        case 'lastActivity':   return (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '');
        case 'openRequests':   return (b.openTaktRequests ?? 0) - (a.openTaktRequests ?? 0);
        case 'overdueRequests':return (b.overdueTaktRequests ?? 0) - (a.overdueTaktRequests ?? 0);
        default: return 0;
      }
    });

    return result;
  }, [projects, search, statusFilter, onlyOpen, onlyOverdue, sortKey]);

  // ── Create project handler ────────────────────────────────────────────────────
  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createProject.mutate({
      data: {
        name:        fd.get('name') as string,
        description: fd.get('description') as string,
        location:    fd.get('location') as string,
        startDate:   fd.get('startDate') as string,
        endDate:     fd.get('endDate') as string,
      },
    }, {
      onSuccess: (newProject) => {
        toast({ title: t('common.success') });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetAgProjectsOverviewQueryKey() });
        setIsCreateOpen(false);
        setLocation(`/projects/${newProject.id}`);
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  // ── Loading skeleton ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <AlertTriangle className="w-10 h-10 text-red-500" />
          <h2 className="text-lg font-semibold">Projektdaten konnten nicht geladen werden</h2>
          <p className="text-sm text-muted-foreground">Bitte prüfen Sie die Serververbindung und versuchen Sie es erneut.</p>
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Erneut versuchen
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-7xl mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('projects.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Projektübersicht mit Koordinationsstand und AN-Zuordnungen.
          </p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t('projects.create')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{t('projects.newProject')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('projects.name')}</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">{t('projects.description')}</Label>
                <Input id="description" name="description" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">{t('projects.location')}</Label>
                <Input id="location" name="location" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate">{t('projects.startDate')}</Label>
                  <Input id="startDate" name="startDate" type="date" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">{t('projects.endDate')}</Label>
                  <Input id="endDate" name="endDate" type="date" required />
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={createProject.isPending}>
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* ── KPI summary strip ───────────────────────────────────────────────── */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Projekte gesamt" value={kpis.total} />
          <KpiCard label="Aktive Projekte" value={kpis.active} highlight />
          <KpiCard label="Offene Anfragen" value={kpis.openTotal} warn={kpis.openTotal > 0} />
          <KpiCard label="Überfällig" value={kpis.overdueTotal} warn={kpis.overdueTotal > 0} />
          <KpiCard label="Bestätigt" value={kpis.accepted} highlight={kpis.accepted > 0} />
          <KpiCard label="AN-Zuordnungen" value={kpis.anTotal} />
        </div>
      )}

      {/* ── Filter + sort toolbar ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder={t('projects.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-card"
          />
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[150px]">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Status</SelectItem>
            <SelectItem value="ACTIVE">Aktiv</SelectItem>
            <SelectItem value="COMPLETED">Abgeschlossen</SelectItem>
            <SelectItem value="ARCHIVED">Archiviert</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="w-[180px]">
            <ArrowUpDown className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lastActivity">Letzte Aktivität</SelectItem>
            <SelectItem value="name">Projektname</SelectItem>
            <SelectItem value="openRequests">Offene Anfragen</SelectItem>
            <SelectItem value="overdueRequests">Überfällig</SelectItem>
          </SelectContent>
        </Select>

        {/* Toggle filters */}
        <button
          onClick={() => setOnlyOpen(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
            onlyOpen
              ? 'border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400'
              : 'border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clock className="w-3.5 h-3.5" />
          Offene Anfragen
        </button>

        <button
          onClick={() => setOnlyOverdue(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
            onlyOverdue
              ? 'border-red-500 bg-red-500/10 text-red-700 dark:text-red-400'
              : 'border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          Überfällige Anfragen
        </button>

        {(search || statusFilter !== 'ALL' || onlyOpen || onlyOverdue) && (
          <button
            onClick={() => { setSearch(''); setStatusFilter('ALL'); setOnlyOpen(false); setOnlyOverdue(false); }}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      {/* ── Project cards ────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 px-4 border border-dashed rounded-xl border-border bg-card/50">
          <Briefcase className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">
            {projects?.length === 0 ? t('projects.noProjects') : 'Keine Projekte entsprechen den Filterkriterien'}
          </h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
            {projects?.length === 0
              ? 'Legen Sie Ihr erstes Projekt an, um mit der Taktplanung zu beginnen.'
              : 'Passen Sie die Filter an oder setzen Sie sie zurück.'}
          </p>
          {projects?.length === 0 && (
            <Button onClick={() => setIsCreateOpen(true)} className="mt-6" variant="outline">
              <Plus className="w-4 h-4 mr-2" />
              {t('projects.create')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map(project => (
            <ProjectCard key={project.projectId} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── ProjectCard component ──────────────────────────────────────────────────────

function ProjectCard({ project }: { project: AgProjectSummary }) {
  const trades = project.assignedTrades ?? [];
  const visibleTrades = trades.slice(0, 3);
  const remainingTrades = trades.length - 3;

  return (
    <Link href={`/projects/${project.projectId}`}>
      <Card className="hover:border-primary/50 transition-all duration-150 cursor-pointer group bg-card h-full flex flex-col">
        <CardContent className="p-5 flex flex-col flex-1 gap-0">

          {/* Header */}
          <div className="flex items-start justify-between mb-3 gap-2">
            <div className="font-semibold text-base line-clamp-1 group-hover:text-primary transition-colors flex-1 min-w-0">
              {project.projectName}
            </div>
            <Badge
              variant={STATUS_VARIANT[project.projectStatus] ?? 'secondary'}
              className="shrink-0 text-[11px]"
            >
              {STATUS_LABEL[project.projectStatus] ?? project.projectStatus}
            </Badge>
          </div>

          {/* Location */}
          {project.location && (
            <div className="flex items-center text-xs text-muted-foreground gap-1.5 mb-1.5">
              <MapPin className="w-3.5 h-3.5 opacity-60 shrink-0" />
              <span className="line-clamp-1">{project.location}</span>
            </div>
          )}

          {/* Description */}
          {project.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mb-2 leading-relaxed">
              {project.description}
            </p>
          )}

          {/* Dates */}
          <div className="flex items-center text-xs text-muted-foreground gap-1.5 mb-3">
            <Calendar className="w-3.5 h-3.5 opacity-60 shrink-0" />
            <span>{fmt(project.startDate)} – {fmt(project.endDate)}</span>
          </div>

          {/* Trades */}
          {trades.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {visibleTrades.map((tr) => (
                <span
                  key={tr}
                  className="inline-block px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium"
                >
                  {tr}
                </span>
              ))}
              {remainingTrades > 0 && (
                <span className="inline-block px-2 py-0.5 rounded-full bg-muted text-muted-foreground text-[11px] font-medium">
                  +{remainingTrades}
                </span>
              )}
            </div>
          )}

          {/* KPI row */}
          <div className="mt-auto pt-3 border-t border-border/50 grid grid-cols-3 gap-2">
            {/* AN count */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-0.5">
                <Users className="w-3 h-3" />
              </div>
              <div className="text-sm font-bold tabular-nums">{project.assignedAnCount ?? 0}</div>
              <div className="text-[10px] text-muted-foreground">AN</div>
            </div>

            {/* Open requests */}
            <div className="text-center">
              <div className={`text-sm font-bold tabular-nums ${(project.openTaktRequests ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                {project.openTaktRequests ?? 0}
              </div>
              <div className="text-[10px] text-muted-foreground">Offen</div>
              {(project.overdueTaktRequests ?? 0) > 0 && (
                <div className="text-[10px] font-semibold text-red-500">
                  {project.overdueTaktRequests} üb.
                </div>
              )}
            </div>

            {/* Accepted */}
            <div className="text-center">
              <div className={`text-sm font-bold tabular-nums ${(project.acceptedTaktRequests ?? 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                {project.acceptedTaktRequests ?? 0}
              </div>
              <div className="text-[10px] text-muted-foreground">Bestätigt</div>
            </div>
          </div>

          {/* Footer: alerts + last activity */}
          <div className="flex items-center justify-between mt-2.5 pt-2 border-t border-border/30">
            <div className="flex items-center gap-2">
              {(project.alternativeTaktRequests ?? 0) > 0 && (
                <div className="flex items-center gap-1 text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  {project.alternativeTaktRequests} Vorschlag{(project.alternativeTaktRequests ?? 0) > 1 ? 'vorschläge' : ''}
                </div>
              )}
              {(project.overdueTaktRequests ?? 0) > 0 && (
                <div className="flex items-center gap-1 text-[11px] font-semibold text-red-500 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  {project.overdueTaktRequests} überfällig
                </div>
              )}
              {(project.revisionRequiredRequests ?? 0) > 0 && (
                <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                  {project.revisionRequiredRequests} Revision
                </div>
              )}
              {(project.acceptedTaktRequests ?? 0) > 0 && (project.overdueTaktRequests ?? 0) === 0 && (project.openTaktRequests ?? 0) === 0 && (project.alternativeTaktRequests ?? 0) === 0 && (
                <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  Koordiniert
                </div>
              )}
            </div>
            {project.lastActivityAt && (
              <div className="text-[11px] text-muted-foreground shrink-0 ml-2">
                {fmtRelative(project.lastActivityAt)}
              </div>
            )}
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors shrink-0 ml-1" />
          </div>

        </CardContent>
      </Card>
    </Link>
  );
}
