import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'wouter';
import { format } from 'date-fns';
import {
  useGetProject,
  useListTakte,
  useCreateTakt,
  useUpdateTakt,
  useListProjectContractors,
  useCreateDelegation,
  useUpdateDelegation,
  useListDelegations,
  getListTakteQueryKey,
  getListDelegationsQueryKey,
  getGetProjectQueryKey,
  getListProjectContractorsQueryKey,
  TaktStatus,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';

// gantt-task-react does not export prop types — define them inline
interface TaskListHeaderProps {
  headerHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
}
interface TaskListTableProps {
  rowHeight: number;
  rowWidth: string;
  fontFamily: string;
  fontSize: string;
  tasks: Task[];
  selectedTaskId: string;
  setSelectedTask: (id: string) => void;
}
import {
  ArrowLeft, Plus, Calendar, MapPin,
  AlignLeft, Info, Send, CheckCircle, Clock, Pencil, XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

// ── Status helpers ─────────────────────────────────────────────────────────────

const EDITABLE_STATUSES: TaktStatus[] = ['GEPLANT', 'ABGELEHNT', 'STORNIERT'];

function isTaktEditable(status?: TaktStatus): boolean {
  return !!status && EDITABLE_STATUSES.includes(status);
}

const STATUS_COLOR: Record<TaktStatus, string> = {
  GEPLANT:    '#64748b', // slate-500
  VERGEBEN:   '#f59e0b', // amber-500
  ALTERNATIV: '#3b82f6', // blue-500
  BESTAETIGT: '#10b981', // emerald-500
  ABGELEHNT:  '#ef4444', // red-500
  STORNIERT:  '#94a3b8', // slate-400
};

const STATUS_LABEL: Record<TaktStatus, string> = {
  GEPLANT:    'Geplant',
  VERGEBEN:   'Vergeben',
  ALTERNATIV: 'Gegenvorschlag',
  BESTAETIGT: 'Bestätigt',
  ABGELEHNT:  'Abgelehnt',
  STORNIERT:  'Storniert',
};

function getTaktColor(status?: TaktStatus | null): string {
  return status ? (STATUS_COLOR[status] ?? '#64748b') : '#64748b';
}

// ── Custom Gantt task list (compact, no From/To columns) ──────────────────────

const GanttListHeader: React.FC<TaskListHeaderProps> = ({ headerHeight, rowWidth, fontFamily, fontSize }) => (
  <div
    style={{
      fontFamily, fontSize, height: headerHeight, width: rowWidth,
      display: 'flex', alignItems: 'center', padding: '0 12px',
      borderBottom: '1px solid hsl(var(--border))', borderRight: '1px solid hsl(var(--border))',
      color: 'hsl(var(--muted-foreground))', fontWeight: 600, letterSpacing: '0.07em',
      textTransform: 'uppercase', background: 'hsl(var(--background))',
    }}
  >
    Bezeichnung
  </div>
);

const GanttListTable: React.FC<TaskListTableProps> = ({
  rowHeight, rowWidth, fontFamily, fontSize, tasks, selectedTaskId, setSelectedTask,
}) => (
  <div style={{ fontFamily, fontSize, borderRight: '1px solid hsl(var(--border))' }}>
    {tasks.map((task, idx) => (
      <div
        key={task.id}
        onClick={() => setSelectedTask(task.id)}
        style={{
          height: rowHeight, width: rowWidth,
          display: 'flex', alignItems: 'center', padding: '0 12px',
          cursor: 'pointer', userSelect: 'none',
          borderBottom: '1px solid hsl(var(--border) / 0.4)',
          background: task.id === selectedTaskId
            ? 'hsl(var(--sidebar-accent))'
            : idx % 2 === 0 ? 'hsl(var(--background))' : 'hsl(var(--card) / 0.6)',
          color: 'hsl(var(--foreground))',
        }}
      >
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%', fontSize: '11px' }}>
          {task.name}
        </div>
      </div>
    ))}
  </div>
);

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);
  const [selectedTaktId, setSelectedTaktId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);

  // Queries
  const { data: project, isLoading: projectLoading } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });
  const { data: takte, isLoading: takteLoading } = useListTakte(projectId, {
    query: { enabled: !!projectId, queryKey: getListTakteQueryKey(projectId) },
  });
  const { data: contractors } = useListProjectContractors(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectContractorsQueryKey(projectId) },
  });
  const { data: delegations } = useListDelegations({ projectId }, {
    query: { enabled: !!projectId, queryKey: getListDelegationsQueryKey({ projectId }) },
  });

  // Mutations
  const createTakt = useCreateTakt();
  const updateTakt = useUpdateTakt();
  const createDelegation = useCreateDelegation();
  const updateDelegation = useUpdateDelegation();

  // Derived
  const ganttTasks: Task[] = useMemo(() => {
    if (!takte || takte.length === 0) return [];
    return takte.map(takt => {
      const color = getTaktColor(takt.status);
      return {
        id: takt.id,
        name: `${takt.taktBezeichnung} · ${takt.gewerk}`,
        start: new Date(takt.plannedStart),
        end: new Date(takt.plannedEnd),
        type: 'task' as const,
        progress: 100,
        isDisabled: false,
        styles: {
          progressColor: color,
          progressSelectedColor: color,
          backgroundColor: color + '80',
          backgroundSelectedColor: color + 'aa',
        },
      };
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [takte]);

  const selectedTakt = useMemo(() => takte?.find(t => t.id === selectedTaktId), [takte, selectedTaktId]);
  const editTakt = useMemo(() => takte?.find(t => t.id === editTargetId), [takte, editTargetId]);

  const taktDelegation = useMemo(
    () => delegations?.find(d => d.taktId === selectedTaktId && d.status !== 'CANCELLED'),
    [delegations, selectedTaktId],
  );

  // Any click opens the info Sheet; editing is started via the button inside the Sheet
  function handleGanttClick(taktId: string) {
    setSelectedTaktId(taktId);
  }

  function handleTaktRowClick(taktId: string) {
    setSelectedTaktId(taktId);
  }

  function handleOpenEdit() {
    if (!selectedTaktId) return;
    setEditTargetId(selectedTaktId);
    setSelectedTaktId(null); // close Sheet so Edit Dialog has full focus
    setIsEditOpen(true);
  }

  const invalidateTakte = () => {
    queryClient.invalidateQueries({ queryKey: getListTakteQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListDelegationsQueryKey({ projectId }) });
    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
  };

  const handleCreateTakt = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createTakt.mutate({
      projectId,
      data: {
        taktBezeichnung: fd.get('taktBezeichnung') as string,
        zone: fd.get('zone') as string,
        gewerk: fd.get('gewerk') as string,
        description: (fd.get('description') as string) || undefined,
        plannedStart: fd.get('plannedStart') as string,
        plannedEnd: fd.get('plannedEnd') as string,
        earliestStart: (fd.get('earliestStart') as string) || undefined,
        latestEnd: (fd.get('latestEnd') as string) || undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: 'Takt angelegt' });
        invalidateTakte();
        setIsCreateOpen(false);
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  const handleEditTakt = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editTargetId) return;
    const fd = new FormData(e.currentTarget);
    updateTakt.mutate({
      projectId,
      taktId: editTargetId,
      data: {
        taktBezeichnung: fd.get('taktBezeichnung') as string,
        zone: fd.get('zone') as string,
        gewerk: fd.get('gewerk') as string,
        description: (fd.get('description') as string) || undefined,
        plannedStart: fd.get('plannedStart') as string,
        plannedEnd: fd.get('plannedEnd') as string,
        earliestStart: (fd.get('earliestStart') as string) || undefined,
        latestEnd: (fd.get('latestEnd') as string) || undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: 'Takt gespeichert' });
        invalidateTakte();
        setIsEditOpen(false);
        setEditTargetId(null);
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  const handleDelegateTakt = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editTakt && !selectedTakt) return;
    const takt = editTakt ?? selectedTakt!;
    const fd = new FormData(e.currentTarget);
    createDelegation.mutate({
      data: {
        taktId: takt.id,
        anOrgId: fd.get('anOrgId') as string,
        requestedStart: fd.get('requestedStart') as string,
        requestedEnd: fd.get('requestedEnd') as string,
        earliestStart: takt.earliestStart || undefined,
        latestEnd: takt.latestEnd || undefined,
        message: (fd.get('message') as string) || undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: 'Takt vergeben' });
        invalidateTakte();
        setIsEditOpen(false);
        setEditTargetId(null);
        setSelectedTaktId(null);
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  const handleCancelDelegation = () => {
    if (!taktDelegation) return;
    updateDelegation.mutate({
      delegationId: taktDelegation.id,
      data: { status: 'CANCELLED' },
    }, {
      onSuccess: () => {
        toast({ title: 'Vergabe storniert' });
        invalidateTakte();
        setSelectedTaktId(null);
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  if (projectLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (!project) return <div>Projekt nicht gefunden</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500 h-full flex flex-col">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/projects">
            <Button variant="outline" size="icon" className="h-9 w-9">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
              <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'}>{project.status}</Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              {project.location && (
                <span className="flex items-center"><MapPin className="w-3.5 h-3.5 mr-1" /> {project.location}</span>
              )}
              <span className="flex items-center">
                <Calendar className="w-3.5 h-3.5 mr-1" />
                {project.startDate ? format(new Date(project.startDate), 'dd.MM.yyyy') : 'TBD'} –{' '}
                {project.endDate ? format(new Date(project.endDate), 'dd.MM.yyyy') : 'TBD'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link href={`/projects/${projectId}/proposals`}>
            <Button variant="outline" className="relative">
              {project.pendingResponseCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                </span>
              )}
              <AlignLeft className="w-4 h-4 mr-2" />
              {t('projects.proposals')}
            </Button>
          </Link>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Neuer Takt
          </Button>
        </div>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {(Object.entries(STATUS_LABEL) as [TaktStatus, string][]).map(([s, label]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
            {label}
          </span>
        ))}
      </div>

      {/* Takt table + Gantt */}
      <div className="flex-1 min-h-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col">
        <div className="border-b border-border p-4 bg-background flex items-center justify-between">
          <h2 className="font-semibold text-lg flex items-center">
            <AlignLeft className="w-5 h-5 mr-2 text-primary" />
            {t('projects.gantt')}
          </h2>
          <Select value={viewMode} onValueChange={(val) => setViewMode(val as ViewMode)}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue placeholder="Ansicht" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ViewMode.Day}>Tag</SelectItem>
              <SelectItem value={ViewMode.Week}>Woche</SelectItem>
              <SelectItem value={ViewMode.Month}>Monat</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 overflow-auto p-4 custom-gantt-container bg-background">
          {takteLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">Lade Plan…</div>
          ) : ganttTasks.length > 0 ? (
            <div className="rounded-lg border border-border overflow-hidden bg-card text-card-foreground">
              <style dangerouslySetInnerHTML={{__html: `
                .gantt { font-family: inherit !important; }
                ._CZjuD { background: hsl(var(--background)) !important; }
                ._3zlnZ { fill: hsl(var(--card)) !important; }
                ._3wXGj { fill: hsl(var(--foreground)) !important; }
                ._3r-f2 { stroke: hsl(var(--border)) !important; }
                ._3vWJ5 { fill: hsl(var(--muted)) !important; }
                ._2k9Ys { fill: hsl(var(--border)) !important; }
                ._9w8d5 { fill: hsl(var(--muted-foreground)) !important; }
                ._2q1Ar { fill: hsl(var(--muted-foreground)) !important; }
              `}} />
              <Gantt
                tasks={ganttTasks}
                viewMode={viewMode}
                onClick={(task) => handleGanttClick(task.id)}
                listCellWidth="190px"
                columnWidth={viewMode === ViewMode.Day ? 38 : viewMode === ViewMode.Week ? 120 : 180}
                rowHeight={40}
                headerHeight={48}
                fontSize="11"
                fontFamily="inherit"
                TaskListHeader={GanttListHeader}
                TaskListTable={GanttListTable}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Calendar className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">Noch keine Takte geplant</h3>
              <p className="text-muted-foreground text-sm max-w-sm mt-1">
                Legen Sie Takte an, um Ihren Projektablauf zu strukturieren.
              </p>
              <Button onClick={() => setIsCreateOpen(true)} className="mt-6">
                <Plus className="w-4 h-4 mr-2" />
                Ersten Takt anlegen
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ── Delegation / Status Side Panel ──────────────────────────────────── */}
      <Sheet open={!!selectedTaktId} onOpenChange={(open) => !open && setSelectedTaktId(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto border-l-border">
          {selectedTakt && (
            <>
              <SheetHeader className="mb-6">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="font-mono text-xs">{selectedTakt.taktBezeichnung}</Badge>
                    <Badge
                      style={{
                        backgroundColor: getTaktColor(selectedTakt.status) + '20',
                        color: getTaktColor(selectedTakt.status),
                      }}
                      className="border-transparent"
                    >
                      {STATUS_LABEL[selectedTakt.status] ?? selectedTakt.status}
                    </Badge>
                  </div>
                  {isTaktEditable(selectedTakt.status) && (
                    <Button size="sm" variant="outline" onClick={handleOpenEdit}>
                      <Pencil className="w-3.5 h-3.5 mr-1.5" />
                      Bearbeiten
                    </Button>
                  )}
                </div>
                <SheetTitle className="text-xl">{selectedTakt.gewerk}</SheetTitle>
                <SheetDescription>Zone: {selectedTakt.zone}</SheetDescription>
              </SheetHeader>

              <div className="space-y-6">
                {/* Details */}
                <Card className="bg-muted/30 border-border/50">
                  <CardContent className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Plan-Start</div>
                        <div className="text-sm font-medium">{format(new Date(selectedTakt.plannedStart), 'dd.MM.yyyy')}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Plan-Ende</div>
                        <div className="text-sm font-medium">{format(new Date(selectedTakt.plannedEnd), 'dd.MM.yyyy')}</div>
                      </div>
                    </div>
                    {(selectedTakt.earliestStart || selectedTakt.latestEnd) && (
                      <div className="pt-3 border-t border-border/50">
                        <div className="flex items-center text-xs text-amber-500 font-medium mb-2">
                          <Info className="w-3.5 h-3.5 mr-1" /> Pufferfenster definiert
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Frühester Start</div>
                            <div className="text-sm">{selectedTakt.earliestStart ? format(new Date(selectedTakt.earliestStart), 'dd.MM.yyyy') : '–'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Spätestes Ende</div>
                            <div className="text-sm">{selectedTakt.latestEnd ? format(new Date(selectedTakt.latestEnd), 'dd.MM.yyyy') : '–'}</div>
                          </div>
                        </div>
                      </div>
                    )}
                    {selectedTakt.description && (
                      <div className="pt-3 border-t border-border/50">
                        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Beschreibung</div>
                        <div className="text-sm text-foreground/80">{selectedTakt.description}</div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Delegation section — shown for delegated takte */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center">
                    <Send className="w-4 h-4 mr-2 text-primary" />
                    Vergabe
                  </h3>

                  {taktDelegation ? (
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg border border-border bg-card">
                        <div className="text-sm font-medium mb-1">Aktuelle Vergabe</div>
                        <div className="text-sm text-muted-foreground mb-4">
                          AN: <span className="text-foreground">{taktDelegation.anOrganization?.name ?? 'Nachunternehmer'}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Angefragt Start</div>
                            <div className="text-sm">{format(new Date(taktDelegation.requestedStart), 'dd.MM.yyyy')}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Angefragt Ende</div>
                            <div className="text-sm">{format(new Date(taktDelegation.requestedEnd), 'dd.MM.yyyy')}</div>
                          </div>
                        </div>

                        {taktDelegation.status === 'PENDING' && (
                          <div className="flex items-center justify-center p-3 rounded bg-amber-500/10 text-amber-500 text-sm font-medium">
                            <Clock className="w-4 h-4 mr-2" /> Warte auf Antwort
                          </div>
                        )}
                        {taktDelegation.status === 'CONFIRMED' && (
                          <div className="flex items-center justify-center p-3 rounded bg-emerald-500/10 text-emerald-500 text-sm font-medium">
                            <CheckCircle className="w-4 h-4 mr-2" /> Termin bestätigt
                          </div>
                        )}
                        {taktDelegation.status === 'ALTERNATIVE_PROPOSED' && (
                          <div className="mt-4 pt-4 border-t border-border">
                            <Link href={`/projects/${projectId}/proposals`}>
                              <Button variant="outline" className="w-full border-blue-500 text-blue-500 hover:bg-blue-500/10">
                                Gegenvorschlag prüfen
                              </Button>
                            </Link>
                          </div>
                        )}
                        {taktDelegation.status === 'REJECTED' && (
                          <div className="flex items-center justify-center p-3 rounded bg-red-500/10 text-red-500 text-sm font-medium">
                            <XCircle className="w-4 h-4 mr-2" /> Abgelehnt
                          </div>
                        )}
                      </div>

                      {/* Cancel button — only for PENDING or ALTERNATIVE_PROPOSED */}
                      {(taktDelegation.status === 'PENDING' || taktDelegation.status === 'ALTERNATIVE_PROPOSED') && (
                        <Button
                          variant="outline"
                          className="w-full border-red-500/50 text-red-500 hover:bg-red-500/10"
                          onClick={handleCancelDelegation}
                          disabled={updateDelegation.isPending}
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          {updateDelegation.isPending ? 'Storniere…' : 'Vergabe stornieren'}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground italic">Keine aktive Vergabe.</div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Edit Takt Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={isEditOpen} onOpenChange={(open) => { if (!open) { setIsEditOpen(false); setEditTargetId(null); } }}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="w-4 h-4 text-primary" />
              Takt bearbeiten
              {editTakt && (
                <Badge style={{ backgroundColor: getTaktColor(editTakt.status) + '20', color: getTaktColor(editTakt.status) }} className="border-transparent ml-1">
                  {STATUS_LABEL[editTakt.status]}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {editTakt && (
            <div className="space-y-6">
              {/* Edit form */}
              <form id="edit-takt-form" onSubmit={handleEditTakt} className="space-y-4 pt-2">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Takt-Bezeichnung</Label>
                    <Input name="taktBezeichnung" required defaultValue={editTakt.taktBezeichnung} placeholder="z.B. T1, Rohbau-A" />
                  </div>
                  <div className="space-y-2">
                    <Label>Zone</Label>
                    <Input name="zone" required defaultValue={editTakt.zone} placeholder="z.B. OG 1, Abschnitt A" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Gewerk</Label>
                  <Input name="gewerk" required defaultValue={editTakt.gewerk} placeholder="z.B. Trockenbau, Elektro" />
                </div>
                <div className="space-y-2">
                  <Label>Beschreibung</Label>
                  <Input name="description" defaultValue={editTakt.description ?? ''} />
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="space-y-2">
                    <Label>Plan-Start</Label>
                    <Input name="plannedStart" type="date" required defaultValue={editTakt.plannedStart} />
                  </div>
                  <div className="space-y-2">
                    <Label>Plan-Ende</Label>
                    <Input name="plannedEnd" type="date" required defaultValue={editTakt.plannedEnd} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/50">
                  <div className="space-y-2">
                    <Label className="text-muted-foreground flex items-center gap-1">Frühester Start <span className="text-[10px]">(Puffer)</span></Label>
                    <Input name="earliestStart" type="date" defaultValue={editTakt.earliestStart ?? ''} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-muted-foreground flex items-center gap-1">Spätestes Ende <span className="text-[10px]">(Puffer)</span></Label>
                    <Input name="latestEnd" type="date" defaultValue={editTakt.latestEnd ?? ''} />
                  </div>
                </div>
              </form>

              {/* Vergabe-Form — only shown for GEPLANT / ABGELEHNT / STORNIERT */}
              <div className="border-t border-border/50 pt-4">
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Send className="w-3.5 h-3.5 text-primary" /> Direkt vergeben
                </h4>
                <form onSubmit={handleDelegateTakt} className="space-y-3">
                  <Select name="anOrgId" required>
                    <SelectTrigger>
                      <SelectValue placeholder="Nachunternehmer auswählen…" />
                    </SelectTrigger>
                    <SelectContent>
                      {contractors?.map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Anfrage-Start</Label>
                      <Input type="date" name="requestedStart" defaultValue={editTakt.plannedStart} required />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Anfrage-Ende</Label>
                      <Input type="date" name="requestedEnd" defaultValue={editTakt.plannedEnd} required />
                    </div>
                  </div>
                  <Textarea name="message" placeholder="Hinweis (optional)" className="resize-none h-16" />
                  <Button type="submit" variant="outline" className="w-full" disabled={createDelegation.isPending || !contractors?.length}>
                    <Send className="w-3.5 h-3.5 mr-2" />
                    {createDelegation.isPending ? 'Vergabe läuft…' : 'Takt vergeben'}
                  </Button>
                </form>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setIsEditOpen(false); setEditTargetId(null); }}>
                  Abbrechen
                </Button>
                <Button type="submit" form="edit-takt-form" disabled={updateTakt.isPending}>
                  {updateTakt.isPending ? 'Speichert…' : 'Speichern'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Create Takt Dialog ────────────────────────────────────────────────── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Neuen Takt anlegen</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateTakt} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Takt-Bezeichnung</Label>
                <Input name="taktBezeichnung" required placeholder="z.B. T1, Rohbau-A" />
              </div>
              <div className="space-y-2">
                <Label>Zone</Label>
                <Input name="zone" required placeholder="z.B. OG 1, Abschnitt A" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Gewerk</Label>
              <Input name="gewerk" required placeholder="z.B. Trockenbau, Elektro" />
            </div>
            <div className="space-y-2">
              <Label>Beschreibung</Label>
              <Input name="description" />
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <Label>Plan-Start</Label>
                <Input name="plannedStart" type="date" required />
              </div>
              <div className="space-y-2">
                <Label>Plan-Ende</Label>
                <Input name="plannedEnd" type="date" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/50 mt-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-1">Frühester Start <span className="text-[10px]">(Puffer)</span></Label>
                <Input name="earliestStart" type="date" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-1">Spätestes Ende <span className="text-[10px]">(Puffer)</span></Label>
                <Input name="latestEnd" type="date" />
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={createTakt.isPending}>Takt anlegen</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
