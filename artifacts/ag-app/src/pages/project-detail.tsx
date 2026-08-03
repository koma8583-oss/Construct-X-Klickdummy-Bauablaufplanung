import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'wouter';
import NetzplanView from '@/components/NetzplanView';
import { format } from 'date-fns';
import {
  useGetProject,
  useListTakte,
  useCreateTakt,
  useUpdateTakt,
  useDeleteTakt,
  useListProjectContractors,
  useAddProjectContractor,
  useRemoveProjectContractor,
  useListOrganizations,
  useListTaktRequests,
  useCreateTaktRequestWithSnapshot,
  useSendTaktRequest,
  useCreateGuDecision,
  useListTaktDependencies,
  useCreateTaktDependency,
  useDeleteTaktDependency,
  getListTakteQueryKey,
  getListTaktRequestsQueryKey,
  getGetProjectQueryKey,
  getListProjectContractorsQueryKey,
  getListOrganizationsQueryKey,
  getListTaktDependenciesQueryKey,
  TaktStatus,
  TaktLifecycleStatus,
  TaktDependencyType,
} from '@workspace/api-client-react';
import type { TaktDependency, TaktUpdateResult, RescheduledTakt, TaktRequestListItem } from '@workspace/api-client-react';
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
  Link2, Trash2, AlertTriangle, ChevronDown, ChevronUp, Users, X, Search, Network,
  AlertCircle, Building2,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';

import {
  useGetAgProjectOverview,
  useListProjectSubcontractors,
  useCreateProjectSubcontractor,
  useUpdateProjectSubcontractor,
  useDeactivateProjectSubcontractor,
  getListProjectSubcontractorsQueryKey,
} from '@workspace/api-client-react';

// ── Status helpers ─────────────────────────────────────────────────────────────

const EDITABLE_STATUSES: TaktStatus[] = ['GEPLANT', 'ABGELEHNT', 'STORNIERT'];

function isTaktEditable(status?: TaktStatus): boolean {
  return !!status && EDITABLE_STATUSES.includes(status);
}

const STATUS_COLOR: Record<TaktStatus, string> = {
  GEPLANT:    '#64748b',
  VERGEBEN:   '#f59e0b',
  ALTERNATIV: '#3b82f6',
  BESTAETIGT: '#10b981',
  ABGELEHNT:  '#ef4444',
  STORNIERT:  '#94a3b8',
};

const STATUS_LABEL: Record<TaktStatus, string> = {
  GEPLANT:    'Geplant',
  VERGEBEN:   'Vergeben',
  ALTERNATIV: 'Gegenvorschlag',
  BESTAETIGT: 'Bestätigt',
  ABGELEHNT:  'Abgelehnt',
  STORNIERT:  'Storniert',
};

const LIFECYCLE_COLOR: Record<TaktLifecycleStatus, string> = {
  DRAFT:          '#94a3b8',
  PLANNED:        '#3b82f6',
  IN_COORDINATION:'#f59e0b',
  CONFIRMED:      '#10b981',
  CANCELLED:      '#ef4444',
};

const LIFECYCLE_LABEL: Record<TaktLifecycleStatus, string> = {
  DRAFT:          'Entwurf',
  PLANNED:        'Bereit',
  IN_COORDINATION:'In Abstimmung',
  CONFIRMED:      'Koordiniert',
  CANCELLED:      'Abgebrochen',
};

function getLifecycleColor(s?: TaktLifecycleStatus | null): string {
  return s ? (LIFECYCLE_COLOR[s] ?? '#94a3b8') : '#94a3b8';
}

const DEP_TYPE_LABEL: Record<TaktDependencyType, string> = {
  EA: 'Ende → Anfang',
  AA: 'Anfang → Anfang',
  EE: 'Ende → Ende',
};

// Colour + dash style per dep type for the tooltip badge
const DEP_TYPE_COLOR: Record<TaktDependencyType, string> = {
  EA: '#10b981',
  AA: '#3b82f6',
  EE: '#f59e0b',
};

/** Build a memoisation-safe TooltipContent component that closes over dep data. */
function makeGanttTooltip(
  depsBySuccessor: Map<string, TaktDependency[]>,
  taktNameById: Map<string, string>,
): React.FC<{ task: Task; fontSize: string; fontFamily: string }> {
  return function GanttTooltip({ task, fontSize, fontFamily }) {
    const inDeps = depsBySuccessor.get(task.id) ?? [];
    return (
      <div
        style={{
          fontFamily,
          fontSize,
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 8,
          padding: '10px 14px',
          minWidth: 200,
          maxWidth: 280,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, fontSize: '12px' }}>{task.name}</div>
        <div style={{ color: 'hsl(var(--muted-foreground))', fontSize: '11px', marginBottom: inDeps.length ? 8 : 0 }}>
          {format(task.start, 'dd.MM.yyyy')} – {format(task.end, 'dd.MM.yyyy')}
        </div>
        {inDeps.length > 0 && (
          <>
            <div style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'hsl(var(--muted-foreground))', marginBottom: 4 }}>
              Vorgänger
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {inDeps.map(dep => (
                <div key={dep.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '11px' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: DEP_TYPE_COLOR[dep.type as TaktDependencyType] + '22',
                    color: DEP_TYPE_COLOR[dep.type as TaktDependencyType],
                    borderRadius: 4, padding: '1px 5px', fontWeight: 700, fontSize: '10px',
                    border: `1px solid ${DEP_TYPE_COLOR[dep.type as TaktDependencyType]}44`,
                    minWidth: 28,
                  }}>
                    {dep.type}
                  </span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {taktNameById.get(dep.predecessorId) ?? dep.predecessorId}
                  </span>
                  {dep.lagDays > 0 && (
                    <span style={{ color: 'hsl(var(--muted-foreground))', fontSize: '10px', whiteSpace: 'nowrap' }}>
                      +{dep.lagDays}d
                    </span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  };
}

function getTaktColor(status?: TaktStatus | null): string {
  return status ? (STATUS_COLOR[status] ?? '#64748b') : '#64748b';
}

// ── Custom Gantt task list ──────────────────────────────────────────────────

const GanttListHeader: React.FC<TaskListHeaderProps> = ({ headerHeight, rowWidth, fontFamily, fontSize }) => (
  <div style={{
    fontFamily, fontSize, height: headerHeight, width: rowWidth,
    display: 'flex', alignItems: 'center', padding: '0 12px',
    borderBottom: '1px solid hsl(var(--border))', borderRight: '1px solid hsl(var(--border))',
    color: 'hsl(var(--muted-foreground))', fontWeight: 600, letterSpacing: '0.07em',
    textTransform: 'uppercase', background: 'hsl(var(--background))',
  }}>
    Bezeichnung
  </div>
);

/** Build a memoisation-safe GanttListTable that closes over takte for lifecycle badges. */
function makeGanttListTable(
  taktById: Map<string, { lifecycleStatus?: TaktLifecycleStatus | null }>,
): React.FC<TaskListTableProps> {
  return function GanttListTable({ rowHeight, rowWidth, fontFamily, fontSize, tasks, selectedTaskId, setSelectedTask }) {
    return (
      <div style={{ fontFamily, fontSize, borderRight: '1px solid hsl(var(--border))' }}>
        {tasks.map((task, idx) => {
          const lc = taktById.get(task.id)?.lifecycleStatus ?? null;
          const lcColor = getLifecycleColor(lc as TaktLifecycleStatus | null);
          const lcLabel = lc ? (LIFECYCLE_LABEL[lc as TaktLifecycleStatus] ?? lc) : null;
          return (
            <div
              key={task.id}
              onClick={() => setSelectedTask(task.id)}
              style={{
                height: rowHeight, width: rowWidth,
                display: 'flex', alignItems: 'center', padding: '0 12px', gap: 6,
                cursor: 'pointer', userSelect: 'none',
                borderBottom: '1px solid hsl(var(--border) / 0.4)',
                background: task.id === selectedTaskId
                  ? 'hsl(var(--sidebar-accent))'
                  : idx % 2 === 0 ? 'hsl(var(--background))' : 'hsl(var(--card) / 0.6)',
                color: 'hsl(var(--foreground))',
              }}
            >
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontSize: '11px' }}>
                {task.name}
              </div>
              {lcLabel && lc !== 'PLANNED' && (
                <span style={{
                  flexShrink: 0,
                  fontSize: '9px', fontWeight: 600, lineHeight: 1,
                  padding: '2px 5px', borderRadius: 4,
                  background: lcColor + '22',
                  color: lcColor,
                  border: `1px solid ${lcColor}44`,
                  whiteSpace: 'nowrap',
                }}>
                  {lcLabel}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeChartTab, setActiveChartTab] = useState<'gantt' | 'netzplan'>('gantt');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Month);
  const [selectedTaktId, setSelectedTaktId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<'details' | 'deps'>('details');

  // Inline Vergabe state in the info panel
  const [isVergabeOpen, setIsVergabeOpen] = useState(false);

  // Contractor management dialog
  const [isContractorMgmtOpen, setIsContractorMgmtOpen] = useState(false);
  const [contractorSearch, setContractorSearch] = useState('');

  // Dependency form state (shared between info panel read and edit dialog write)
  const [newDepPredecessorId, setNewDepPredecessorId] = useState('');
  const [newDepType, setNewDepType] = useState<TaktDependencyType>('EA');
  const [newDepLag, setNewDepLag] = useState(0);

  // Persistent conflict state — populated from the latest reschedule result
  const [activeConflicts, setActiveConflicts] = useState<RescheduledTakt[]>([]);

  // Queries
  const { data: projectOverview, isLoading: projectLoading } = useGetAgProjectOverview(projectId, {
    query: { enabled: !!projectId, queryKey: ['getAgProjectOverview', projectId] },
  });
  const project = projectOverview?.project;
  
  const { data: takte, isLoading: takteLoading } = useListTakte(projectId, {
    query: { enabled: !!projectId, queryKey: getListTakteQueryKey(projectId) },
  });
  const { data: contractors } = useListProjectContractors(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectContractorsQueryKey(projectId) },
  });
  const { data: allAnOrgs } = useListOrganizations(
    { type: 'AN' },
    { query: { queryKey: getListOrganizationsQueryKey({ type: 'AN' }) } },
  );
  const { data: taktRequests } = useListTaktRequests(undefined, {
    query: { enabled: !!projectId, queryKey: getListTaktRequestsQueryKey() },
  });
  const { data: deps } = useListTaktDependencies(projectId, {
    query: { enabled: !!projectId, queryKey: getListTaktDependenciesQueryKey(projectId) },
  });
  const { data: assignments } = useListProjectSubcontractors(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectSubcontractorsQueryKey(projectId) },
  });

  // Mutations
  const createTakt = useCreateTakt();
  const updateTakt = useUpdateTakt();
  const deleteTakt = useDeleteTakt();
  const createTaktRequest = useCreateTaktRequestWithSnapshot();
  const sendTaktRequest = useSendTaktRequest();
  const closeRequest = useCreateGuDecision();
  const addContractor = useAddProjectContractor();
  const removeContractor = useRemoveProjectContractor();
  const createDep = useCreateTaktDependency();
  const deleteDep = useDeleteTaktDependency();
  
  const createAssignment = useCreateProjectSubcontractor();
  const updateAssignment = useUpdateProjectSubcontractor();
  const deactivateAssignment = useDeactivateProjectSubcontractor();

  const [isDelegating, setIsDelegating] = useState(false);

  // State for new AN assignment dialog
  const [isAssignAnOpen, setIsAssignAnOpen] = useState(false);
  const [editAssignmentId, setEditAssignmentId] = useState<string | null>(null);
  const [anStatusFilter, setAnStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PLANNED' | 'INACTIVE'>('ALL');

  // Index: successorId → list of full TaktDependency objects
  const depsBySuccessor = useMemo(() => {
    const map = new Map<string, TaktDependency[]>();
    for (const dep of deps ?? []) {
      const list = map.get(dep.successorId) ?? [];
      list.push(dep);
      map.set(dep.successorId, list);
    }
    return map;
  }, [deps]);

  // Index: taktId → display name (for the tooltip)
  const taktNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of takte ?? []) {
      map.set(t.id, `${t.taktBezeichnung} · ${t.gewerk}`);
    }
    return map;
  }, [takte]);

  // Index: taktId → takt (for lifecycle status lookup in list table)
  const taktById = useMemo(() => {
    const map = new Map<string, { lifecycleStatus?: TaktLifecycleStatus | null }>();
    for (const t of takte ?? []) {
      map.set(t.id, { lifecycleStatus: t.lifecycleStatus });
    }
    return map;
  }, [takte]);

  // Stable tooltip component (recreated only when dep data changes)
  const GanttTooltip = useMemo(
    () => makeGanttTooltip(depsBySuccessor, taktNameById),
    [depsBySuccessor, taktNameById],
  );

  // Stable list table component (recreated when lifecycle statuses change)
  const GanttListTable = useMemo(
    () => makeGanttListTable(taktById),
    [taktById],
  );

  // Set of takt IDs that are currently in conflict
  const conflictTaktIdSet = useMemo(
    () => new Set(activeConflicts.map(c => c.takt.id)),
    [activeConflicts],
  );

  // Gantt tasks with dependency arrows
  const ganttTasks: Task[] = useMemo(() => {
    if (!takte || takte.length === 0) return [];
    return takte.map(takt => {
      const color = getTaktColor(takt.status);
      // All predecessor IDs — the library renders finish-to-start arrows for these;
      // dep type (EA/AA/EE) and lag are shown in the custom TooltipContent.
      const predecessorIds = (depsBySuccessor.get(takt.id) ?? []).map(d => d.predecessorId);
      const isConflict = conflictTaktIdSet.has(takt.id);
      return {
        id: takt.id,
        name: `${takt.taktBezeichnung} · ${takt.gewerk}`,
        start: new Date(takt.plannedStart),
        end: new Date(takt.plannedEnd),
        type: 'task' as const,
        progress: 100,
        isDisabled: false,
        dependencies: predecessorIds,
        styles: isConflict
          ? {
              progressColor: '#ef4444',
              progressSelectedColor: '#dc2626',
              backgroundColor: '#ef444430',
              backgroundSelectedColor: '#ef444450',
            }
          : {
              progressColor: color,
              progressSelectedColor: color,
              backgroundColor: color + '80',
              backgroundSelectedColor: color + 'aa',
            },
      };
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [takte, depsBySuccessor, conflictTaktIdSet]);

  const selectedTakt = useMemo(() => takte?.find(t => t.id === selectedTaktId), [takte, selectedTaktId]);
  const editTakt = useMemo(() => takte?.find(t => t.id === editTargetId), [takte, editTargetId]);

  // Active TaktRequest for the selected takt (info panel)
  const activeTaktRequest = useMemo<TaktRequestListItem | undefined>(() => {
    if (!taktRequests || !selectedTaktId) return undefined;
    return taktRequests
      .filter(r => r.taktId === selectedTaktId && r.status !== 'EXPIRED')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [taktRequests, selectedTaktId]);

  // Predecessors for the info panel (read-only display)
  const selectedTaktPredecessors = useMemo(
    () => deps?.filter(d => d.successorId === selectedTaktId) ?? [],
    [deps, selectedTaktId],
  );

  // Predecessors for the edit dialog (with write controls)
  const editTaktPredecessors = useMemo(
    () => deps?.filter(d => d.successorId === editTargetId) ?? [],
    [deps, editTargetId],
  );

  // Available predecessors for the edit dialog dep form
  const availableEditPredecessors = useMemo(
    () => takte?.filter(
      t => t.id !== editTargetId &&
        !editTaktPredecessors.some(d => d.predecessorId === t.id),
    ) ?? [],
    [takte, editTargetId, editTaktPredecessors],
  );

  function handleGanttClick(taktId: string) {
    setSelectedTaktId(taktId);
    setIsVergabeOpen(false);
  }

  function handleOpenEdit() {
    if (!selectedTaktId) return;
    setEditTargetId(selectedTaktId);
    setSelectedTaktId(null);
    setIsVergabeOpen(false);
    setEditTab('details');
    setNewDepPredecessorId('');
    setNewDepLag(0);
    setIsEditOpen(true);
  }

  const invalidateTakte = () => {
    queryClient.invalidateQueries({ queryKey: getListTakteQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListTaktRequestsQueryKey() });
    queryClient.invalidateQueries({ queryKey: ['getAgProjectOverview', projectId] });
    queryClient.invalidateQueries({ queryKey: getListTaktDependenciesQueryKey(projectId) });
  };

  function showRescheduleToasts(moved: TaktUpdateResult['moved'], conflicts: TaktUpdateResult['conflicts']) {
    if (moved.length > 0) {
      toast({
        title: `${moved.length} Takt${moved.length > 1 ? 'e' : ''} automatisch verschoben`,
        description: moved.map(t => t.taktBezeichnung).join(', '),
      });
    }
    if (conflicts.length > 0) {
      toast({
        variant: 'destructive',
        title: `${conflicts.length} Takt${conflicts.length > 1 ? 'e' : ''} konnten nicht verschoben werden`,
        description: conflicts.map(c => `${c.takt.taktBezeichnung} (${STATUS_LABEL[c.takt.status as TaktStatus]}): erforderlich ab ${format(new Date(c.requiredStart), 'dd.MM.yyyy')}`).join(' · '),
      });
    }
    // Always update persistent conflict state (replace with latest result)
    setActiveConflicts(conflicts);
  }

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
      onSuccess: (result) => {
        toast({ title: 'Takt gespeichert' });
        invalidateTakte();
        showRescheduleToasts(result.moved, result.conflicts);
        setIsEditOpen(false);
        setEditTargetId(null);
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  // TaktRequest is created + sent in two steps (snapshot → send)
  const handleDelegateTakt = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTakt || isDelegating) return;
    const fd = new FormData(e.currentTarget);
    const nuOrgId = fd.get('anOrgId') as string;
    const message  = (fd.get('message') as string) || undefined;
    setIsDelegating(true);
    try {
      const created = await createTaktRequest.mutateAsync({
        data: { taktId: selectedTakt.id, nuOrgId, message },
      });
      await sendTaktRequest.mutateAsync({ requestId: (created as { id: string }).id });
      toast({ title: 'TaktAnfrage gesendet' });
      invalidateTakte();
      setIsVergabeOpen(false);
    } catch (err) {
      toast({ title: t('common.error'), description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsDelegating(false);
    }
  };

  const handleDeleteTakt = () => {
    if (!editTargetId) return;
    deleteTakt.mutate({ projectId, taktId: editTargetId }, {
      onSuccess: () => {
        toast({ title: 'Takt gelöscht' });
        invalidateTakte();
        setIsEditOpen(false);
        setEditTargetId(null);
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  const handleAddContractor = (anOrgId: string) => {
    addContractor.mutate({ projectId, data: { anOrgId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectContractorsQueryKey(projectId) });
        toast({ title: 'Nachunternehmer verknüpft' });
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  const handleRemoveContractor = (anOrgId: string) => {
    removeContractor.mutate({ projectId, anOrgId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectContractorsQueryKey(projectId) });
        toast({ title: 'Nachunternehmer entfernt' });
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  const handleCloseRequest = () => {
    if (!activeTaktRequest) return;
    closeRequest.mutate({
      requestId: activeTaktRequest.id,
      data: { decisionType: 'CLOSE_WITHOUT_AGREEMENT' },
    }, {
      onSuccess: () => {
        toast({ title: 'Anfrage ohne Einigung geschlossen' });
        invalidateTakte();
      },
      onError: (err) => toast({ title: t('common.error'), description: (err as Error).message, variant: 'destructive' }),
    });
  };

  // Add dependency — only callable from the edit dialog
  const handleAddDependency = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editTargetId || !newDepPredecessorId) return;
    createDep.mutate({
      projectId,
      data: {
        predecessorId: newDepPredecessorId,
        successorId: editTargetId,
        type: newDepType,
        lagDays: newDepLag,
      },
    }, {
      onSuccess: (result) => {
        toast({ title: 'Abhängigkeit angelegt' });
        invalidateTakte();
        showRescheduleToasts(result.moved, result.conflicts);
        setNewDepPredecessorId('');
        setNewDepLag(0);
      },
      onError: (err) => {
        toast({ title: 'Fehler', description: (err as Error).message, variant: 'destructive' });
      },
    });
  };

  const handleDeleteDependency = (depId: string) => {
    deleteDep.mutate({ projectId, depId }, {
      onSuccess: (result) => {
        toast({ title: 'Abhängigkeit gelöscht' });
        invalidateTakte();
        showRescheduleToasts(result.moved, result.conflicts);
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  const handleDeactivateAssignment = (assignmentId: string) => {
    if (confirm('Möchten Sie diese AN-Zuordnung wirklich deaktivieren?')) {
      deactivateAssignment.mutate({ projectId, assignmentId }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProjectSubcontractorsQueryKey(projectId) });
          toast({ title: 'Zuordnung deaktiviert' });
        },
        onError: (err) => toast({ title: t('common.error'), description: (err as Error).message, variant: 'destructive' })
      });
    }
  };

  const handleCreateAssignment = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createAssignment.mutate({
      projectId,
      data: {
        anOrgId: fd.get('anOrgId') as string,
        trade: (fd.get('trade') as string) || undefined,
        workPackageReference: (fd.get('workPackageReference') as string) || undefined,
        validFrom: (fd.get('validFrom') as string) || undefined,
        validTo: (fd.get('validTo') as string) || undefined,
        assignmentStatus: (fd.get('assignmentStatus') as 'PLANNED' | 'ACTIVE') || 'ACTIVE',
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectSubcontractorsQueryKey(projectId) });
        toast({ title: 'AN-Zuordnung angelegt' });
        setIsAssignAnOpen(false);
      },
      onError: (err) => toast({ title: t('common.error'), description: (err as Error).message, variant: 'destructive' })
    });
  };

  const handleUpdateAssignment = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editAssignmentId) return;
    const fd = new FormData(e.currentTarget);
    updateAssignment.mutate({
      projectId,
      assignmentId: editAssignmentId,
      data: {
        trade: (fd.get('trade') as string) || undefined,
        workPackageReference: (fd.get('workPackageReference') as string) || undefined,
        validFrom: (fd.get('validFrom') as string) || undefined,
        validTo: (fd.get('validTo') as string) || undefined,
        assignmentStatus: (fd.get('assignmentStatus') as 'PLANNED' | 'ACTIVE' | 'INACTIVE') || 'ACTIVE',
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectSubcontractorsQueryKey(projectId) });
        toast({ title: 'AN-Zuordnung gespeichert' });
        setEditAssignmentId(null);
      },
      onError: (err) => toast({ title: t('common.error'), description: (err as Error).message, variant: 'destructive' })
    });
  };

  if (projectLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }
  if (!project || !projectOverview) return <div>Projekt nicht gefunden</div>;

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
              <h1 className="text-3xl font-bold tracking-tight">{project.projectName}</h1>
              <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'}>{project.status}</Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
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
              {projectOverview.coordination.openRequests > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                </span>
              )}
              <AlignLeft className="w-4 h-4 mr-2" />
              {t('projects.proposals')}
            </Button>
          </Link>
          <Button variant="outline" onClick={() => setIsContractorMgmtOpen(true)}>
            <Users className="w-4 h-4 mr-2" />
            Nachunternehmer
            {contractors && contractors.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-semibold">
                {contractors.length}
              </span>
            )}
          </Button>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Neuer Takt
          </Button>
        </div>
      </div>

      {/* KPI Bar */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Takte gesamt</span>
            <span className="text-2xl font-bold">{projectOverview.coordination.numberOfTakts}</span>
          </CardContent>
        </Card>
        <Card className="bg-card border-emerald-500/20">
          <CardContent className="p-4 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Bestätigt</span>
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{projectOverview.coordination.confirmedTakts}</span>
          </CardContent>
        </Card>
        <Card className="bg-card border-amber-500/20">
          <CardContent className="p-4 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider text-amber-600 dark:text-amber-400">In Abstimmung</span>
            <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">{projectOverview.coordination.taktsInCoordination}</span>
          </CardContent>
        </Card>
        <Card className="bg-card border-blue-500/20">
          <CardContent className="p-4 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider text-blue-600 dark:text-blue-400">Offene Anfragen</span>
            <span className="text-2xl font-bold text-blue-600 dark:text-blue-400">{projectOverview.coordination.openRequests}</span>
          </CardContent>
        </Card>
        <Card className={`bg-card ${projectOverview.coordination.overdueRequests > 0 ? 'border-red-500/50 shadow-sm shadow-red-500/10' : ''}`}>
          <CardContent className="p-4 flex flex-col items-center text-center">
            <span className={`text-xs font-medium mb-1 uppercase tracking-wider ${projectOverview.coordination.overdueRequests > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
              Überfällig
            </span>
            <span className={`text-2xl font-bold ${projectOverview.coordination.overdueRequests > 0 ? 'text-red-600 dark:text-red-400 animate-pulse' : ''}`}>
              {projectOverview.coordination.overdueRequests}
            </span>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Revisionsrunden</span>
            <span className="text-2xl font-bold">{projectOverview.coordination.revisionRounds}</span>
          </CardContent>
        </Card>
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <div className="flex flex-wrap gap-3">
          {(Object.entries(STATUS_LABEL) as [TaktStatus, string][]).map(([s, label]) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} />
              {label}
            </span>
          ))}
        </div>
        {/* Dependency type legend — only shown when deps exist */}
        {deps && deps.length > 0 && (
          <div className="flex items-center gap-3 border-l border-border/50 pl-4">
            <span className="text-muted-foreground/60 font-medium uppercase tracking-wider text-[10px]">Abhängigkeit</span>
            {(Object.entries(DEP_TYPE_LABEL) as [TaktDependencyType, string][]).map(([type, label]) => (
              <span key={type} className="flex items-center gap-1.5">
                <span
                  className="inline-flex items-center justify-center rounded px-1 py-0.5 font-bold text-[9px] leading-none"
                  style={{
                    background: DEP_TYPE_COLOR[type] + '22',
                    color: DEP_TYPE_COLOR[type],
                    border: `1px solid ${DEP_TYPE_COLOR[type]}44`,
                  }}
                >
                  {type}
                </span>
                <span>{label}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Chart area — Gantt / Netzplan tabs */}
      <div className="flex-1 min-h-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col">
        {/* Tab header */}
        <div className="border-b border-border px-4 bg-background flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1 h-12">
            <button
              onClick={() => setActiveChartTab('gantt')}
              className={`flex items-center gap-1.5 h-full px-3 text-sm font-medium border-b-2 transition-colors ${
                activeChartTab === 'gantt'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <AlignLeft className="w-4 h-4" />
              {t('projects.gantt')}
            </button>
            <button
              onClick={() => setActiveChartTab('netzplan')}
              className={`flex items-center gap-1.5 h-full px-3 text-sm font-medium border-b-2 transition-colors ${
                activeChartTab === 'netzplan'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Network className="w-4 h-4" />
              Netzplan
            </button>
            <button
              onClick={() => setActiveChartTab('an-zuordnungen' as any)}
              className={`flex items-center gap-1.5 h-full px-3 text-sm font-medium border-b-2 transition-colors ${
                activeChartTab === 'an-zuordnungen' as any
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Users className="w-4 h-4" />
              AN-Zuordnungen
              {assignments && assignments.length > 0 && (
                <span className="ml-1.5 text-xs bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-semibold">
                  {assignments.length}
                </span>
              )}
            </button>
          </div>

          {/* Gantt view-mode selector — only shown on Gantt tab */}
          {activeChartTab === 'gantt' && (
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
          )}
        </div>

        {/* ── Gantt panel ──────────────────────────────────────────────── */}
        {activeChartTab === 'gantt' && (
          <div className="flex-1 overflow-auto p-4 custom-gantt-container bg-background flex flex-col gap-3">
            {/* Persistent conflict banner */}
            {activeConflicts.length > 0 && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-red-500/40 bg-red-500/8 text-sm shrink-0">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-red-500" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-red-600 dark:text-red-400 mb-1">
                    {activeConflicts.length} Terminkonflikt{activeConflicts.length > 1 ? 'e' : ''} — manuelle Anpassung erforderlich
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {activeConflicts.map(c => (
                      <span key={c.takt.id} className="text-xs text-red-700 dark:text-red-300">
                        <span className="font-medium">{c.takt.taktBezeichnung}</span>
                        {' '}({STATUS_LABEL[c.takt.status as TaktStatus]}) — benötigt ab{' '}
                        {format(new Date(c.requiredStart), 'dd.MM.yyyy')}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveConflicts([])}
                  className="shrink-0 p-0.5 rounded text-red-400 hover:text-red-600 hover:bg-red-500/10 transition-colors"
                  title="Hinweis schließen"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
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
                  arrowColor="hsl(var(--primary))"
                  arrowIndent={12}
                  TaskListHeader={GanttListHeader}
                  TaskListTable={GanttListTable}
                  TooltipContent={GanttTooltip}
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
        )}

        {/* ── Netzplan panel ────────────────────────────────────────────── */}
        {activeChartTab === 'netzplan' && (
          <div className="flex-1 min-h-0 overflow-hidden">
            {takteLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">Lade Plan…</div>
            ) : (
              <NetzplanView takte={takte ?? []} deps={deps ?? []} />
            )}
          </div>
        )}
      </div>

      {/* ── Info Side Panel ─────────────────────────────────────────────────── */}
      <Sheet open={!!selectedTaktId} onOpenChange={(open) => { if (!open) { setSelectedTaktId(null); setIsVergabeOpen(false); } }}>
        <SheetContent className="sm:max-w-md overflow-y-auto border-l-border">
          {selectedTakt && (
            <>
              <SheetHeader className="mb-6">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
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
                    {selectedTakt.lifecycleStatus && (
                      <Badge
                        style={{
                          backgroundColor: getLifecycleColor(selectedTakt.lifecycleStatus as TaktLifecycleStatus) + '20',
                          color: getLifecycleColor(selectedTakt.lifecycleStatus as TaktLifecycleStatus),
                        }}
                        className="border-transparent"
                      >
                        {LIFECYCLE_LABEL[selectedTakt.lifecycleStatus as TaktLifecycleStatus] ?? selectedTakt.lifecycleStatus}
                      </Badge>
                    )}
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

                {/* ── Anordnungsbeziehungen — read-only ─────────────────── */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Link2 className="w-4 h-4 text-primary" />
                    Anordnungsbeziehungen
                    {selectedTaktPredecessors.length > 0 && (
                      <Badge variant="secondary" className="text-[10px] ml-1">{selectedTaktPredecessors.length}</Badge>
                    )}
                  </h3>

                  {selectedTaktPredecessors.length > 0 ? (
                    <div className="space-y-2">
                      {selectedTaktPredecessors.map((dep) => {
                        const pred = takte?.find(t => t.id === dep.predecessorId);
                        return (
                          <div
                            key={dep.id}
                            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 bg-muted/20 text-sm"
                          >
                            <span
                              className="inline-block w-2 h-2 rounded-full shrink-0"
                              style={{ background: getTaktColor(pred?.status) }}
                            />
                            <span className="truncate font-medium">{pred?.taktBezeichnung ?? '…'}</span>
                            <span className="text-muted-foreground shrink-0 text-[11px]">{DEP_TYPE_LABEL[dep.type as TaktDependencyType]}</span>
                            {dep.lagDays > 0 && (
                              <span className="text-muted-foreground shrink-0 text-[11px]">+{dep.lagDays}d</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      Keine Abhängigkeiten definiert.
                      {isTaktEditable(selectedTakt.status) && (
                        <> Über <span className="font-medium not-italic">Bearbeiten → Abhängigkeiten</span> hinzufügen.</>
                      )}
                    </p>
                  )}
                </div>

                {/* ── Vergabe ────────────────────────────────────────────── */}
                <div>
                  <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <Send className="w-4 h-4 text-primary" />
                    Vergabe
                  </h3>

                  {activeTaktRequest ? (
                    /* Existing TaktRequest — show status */
                    <div className="space-y-3">
                      <div className="p-4 rounded-lg border border-border bg-card">
                        <div className="text-sm font-medium mb-0.5">TaktAnfrage</div>
                        <div className="text-xs text-muted-foreground font-mono mb-2">{activeTaktRequest.requestNumber}</div>
                        <div className="text-sm text-muted-foreground mb-3">
                          AN: <span className="text-foreground">{activeTaktRequest.nuOrgName ?? '—'}</span>
                        </div>
                        {['SENT', 'DELIVERED', 'DETAILS_RETRIEVED', 'UNDER_REVIEW'].includes(activeTaktRequest.status) && (
                          <div className="flex items-center justify-center p-3 rounded bg-amber-500/10 text-amber-500 text-sm font-medium">
                            <Clock className="w-4 h-4 mr-2" /> Warte auf Antwort
                          </div>
                        )}
                        {activeTaktRequest.status === 'ACCEPTED' && (
                          <div className="flex items-center justify-center p-3 rounded bg-emerald-500/10 text-emerald-500 text-sm font-medium">
                            <CheckCircle className="w-4 h-4 mr-2" /> Termin bestätigt — Entscheidung ausstehend
                          </div>
                        )}
                        {activeTaktRequest.status === 'ALTERNATIVES_PROPOSED' && (
                          <div className="flex items-center justify-center p-3 rounded bg-blue-500/10 text-blue-500 text-sm font-medium">
                            Gegenvorschlag eingegangen
                          </div>
                        )}
                        {activeTaktRequest.status === 'REJECTED' && (
                          <div className="flex items-center justify-center p-3 rounded bg-red-500/10 text-red-500 text-sm font-medium">
                            <XCircle className="w-4 h-4 mr-2" /> Abgelehnt
                          </div>
                        )}
                        {['ACCEPTED', 'ALTERNATIVES_PROPOSED', 'REJECTED'].includes(activeTaktRequest.status) && (
                          <Link href={`/takt-requests/${activeTaktRequest.id}`}>
                            <Button variant="outline" size="sm" className="w-full mt-3">
                              Details / Entscheidung treffen
                            </Button>
                          </Link>
                        )}
                      </div>

                      {['ACCEPTED', 'ALTERNATIVES_PROPOSED', 'REJECTED'].includes(activeTaktRequest.status) && (
                        <Button
                          variant="outline"
                          className="w-full border-red-500/50 text-red-500 hover:bg-red-500/10"
                          onClick={handleCloseRequest}
                          disabled={closeRequest.isPending}
                        >
                          <XCircle className="w-4 h-4 mr-2" />
                          {closeRequest.isPending ? 'Schließe…' : 'Ohne Einigung schließen'}
                        </Button>
                      )}
                    </div>
                  ) : (
                    /* No active request — offer inline form */
                    <div>
                      {!contractors?.length ? (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/50 text-sm text-muted-foreground">
                          <Users className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>
                            Noch kein Nachunternehmer verknüpft.{' '}
                            <button
                              type="button"
                              className="font-medium text-primary hover:underline"
                              onClick={() => setIsContractorMgmtOpen(true)}
                            >
                              Jetzt verknüpfen
                            </button>
                          </span>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setIsVergabeOpen(v => !v)}
                            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors text-sm font-medium text-primary"
                          >
                            <span className="flex items-center gap-2">
                              <Send className="w-3.5 h-3.5" />
                              Takt vergeben
                            </span>
                            {isVergabeOpen
                              ? <ChevronUp className="w-4 h-4" />
                              : <ChevronDown className="w-4 h-4" />
                            }
                          </button>

                          {isVergabeOpen && (
                            <form onSubmit={handleDelegateTakt} className="mt-3 space-y-3 p-3 rounded-lg border border-border/60 bg-muted/10">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Nachunternehmer</Label>
                                <Select name="anOrgId" required>
                                  <SelectTrigger>
                                    <SelectValue placeholder="Auswählen…" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {Array.from(new Map(
                                      (assignments || [])
                                        .filter(a => a.assignmentStatus === 'ACTIVE')
                                        .map(a => [a.anOrgId, a])
                                    ).values()).map(a => (
                                      <SelectItem key={a.id} value={a.anOrgId}>
                                        {a.anName} – {a.trade || 'Alle Gewerke'}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <Textarea name="message" placeholder="Hinweis (optional)" className="resize-none h-16" />
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => setIsVergabeOpen(false)}
                                >
                                  Abbrechen
                                </Button>
                                <Button
                                  type="submit"
                                  size="sm"
                                  className="flex-1"
                                  disabled={isDelegating}
                                >
                                  <Send className="w-3.5 h-3.5 mr-1.5" />
                                  {isDelegating ? 'Vergabe läuft…' : 'Vergeben'}
                                </Button>
                              </div>
                            </form>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Edit Takt Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={isEditOpen} onOpenChange={(open) => { if (!open) { setIsEditOpen(false); setEditTargetId(null); } }}>
        <DialogContent className="sm:max-w-[580px]">
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
            <Tabs value={editTab} onValueChange={(v) => setEditTab(v as 'details' | 'deps')} className="mt-1">
              <TabsList className="w-full">
                <TabsTrigger value="details" className="flex-1">Details</TabsTrigger>
                <TabsTrigger value="deps" className="flex-1">
                  Abhängigkeiten
                  {editTaktPredecessors.length > 0 && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">{editTaktPredecessors.length}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* ── Tab: Details ────────────────────────────────────────── */}
              <TabsContent value="details" className="mt-4 space-y-4">
                <form id="edit-takt-form" onSubmit={handleEditTakt} className="space-y-4">
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

                {deps && deps.some(d => d.predecessorId === editTakt.id || d.successorId === editTakt.id) && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Dieser Takt ist in Anordnungsbeziehungen eingebunden. Beim Speichern werden abhängige Takte automatisch verschoben.</span>
                  </div>
                )}

                <DialogFooter className="flex-row justify-between pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="border-red-500/50 text-red-500 hover:bg-red-500/10"
                    onClick={handleDeleteTakt}
                    disabled={deleteTakt.isPending}
                  >
                    {deleteTakt.isPending ? 'Löscht…' : 'Takt löschen'}
                  </Button>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => { setIsEditOpen(false); setEditTargetId(null); }}>
                      Abbrechen
                    </Button>
                    <Button type="submit" form="edit-takt-form" disabled={updateTakt.isPending}>
                      {updateTakt.isPending ? 'Speichert…' : 'Speichern'}
                    </Button>
                  </div>
                </DialogFooter>
              </TabsContent>

              {/* ── Tab: Abhängigkeiten ──────────────────────────────────── */}
              <TabsContent value="deps" className="mt-4 space-y-4">
                {/* Existing predecessors with delete */}
                {editTaktPredecessors.length > 0 ? (
                  <div className="space-y-2">
                    {editTaktPredecessors.map((dep) => {
                      const pred = takte?.find(t => t.id === dep.predecessorId);
                      return (
                        <div
                          key={dep.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-border/60 bg-muted/20 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="inline-block w-2 h-2 rounded-full shrink-0"
                              style={{ background: getTaktColor(pred?.status) }}
                            />
                            <span className="truncate font-medium">{pred?.taktBezeichnung ?? '…'}</span>
                            <span className="text-muted-foreground shrink-0 text-[11px]">{DEP_TYPE_LABEL[dep.type as TaktDependencyType]}</span>
                            {dep.lagDays > 0 && (
                              <span className="text-muted-foreground shrink-0 text-[11px]">+{dep.lagDays}d</span>
                            )}
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => handleDeleteDependency(dep.id)}
                            disabled={deleteDep.isPending}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Noch keine Vorgänger definiert.</p>
                )}

                {/* Add new predecessor form */}
                {availableEditPredecessors.length > 0 ? (
                  <form onSubmit={handleAddDependency} className="space-y-3 p-3 rounded-lg border border-dashed border-border/60 bg-muted/10">
                    <p className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider">Neuer Vorgänger</p>
                    <Select value={newDepPredecessorId} onValueChange={setNewDepPredecessorId} required>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Vorgänger-Takt…" />
                      </SelectTrigger>
                      <SelectContent>
                        {availableEditPredecessors.map(t => (
                          <SelectItem key={t.id} value={t.id}>
                            <span className="flex items-center gap-2">
                              <span className="inline-block w-2 h-2 rounded-full" style={{ background: getTaktColor(t.status) }} />
                              {t.taktBezeichnung} · {t.gewerk}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2">
                      <Select value={newDepType} onValueChange={(v) => setNewDepType(v as TaktDependencyType)}>
                        <SelectTrigger className="h-9 text-sm flex-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.entries(DEP_TYPE_LABEL) as [TaktDependencyType, string][]).map(([v, label]) => (
                            <SelectItem key={v} value={v}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Input
                          type="number"
                          min={0}
                          value={newDepLag}
                          onChange={e => setNewDepLag(Number(e.target.value))}
                          className="h-9 w-20 text-sm"
                        />
                        <span className="text-sm text-muted-foreground">Tage</span>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      variant="outline"
                      className="w-full"
                      disabled={createDep.isPending || !newDepPredecessorId}
                    >
                      <Link2 className="w-3.5 h-3.5 mr-2" />
                      {createDep.isPending ? 'Anlege…' : 'Abhängigkeit anlegen'}
                    </Button>
                  </form>
                ) : editTaktPredecessors.length > 0 ? null : (
                  <p className="text-sm text-muted-foreground italic">Keine weiteren Takte als Vorgänger verfügbar.</p>
                )}

                <DialogFooter className="flex-row justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => { setIsEditOpen(false); setEditTargetId(null); }}>
                    Schließen
                  </Button>
                </DialogFooter>
              </TabsContent>
            </Tabs>
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

      {/* ── Nachunternehmer verwalten ──────────────────────────────────────────── */}
      <Dialog open={isContractorMgmtOpen} onOpenChange={setIsContractorMgmtOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Nachunternehmer — {project?.projectName}
            </DialogTitle>
          </DialogHeader>

          {/* Verknüpfte Nachunternehmer */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Verknüpft ({contractors?.length ?? 0})
            </p>
            {!contractors?.length ? (
              <p className="text-sm text-muted-foreground italic py-2">Noch keine Nachunternehmer verknüpft.</p>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {contractors.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-card">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-7 h-7 rounded bg-primary/15 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                        {c.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        {c.contactEmail && <div className="text-[11px] text-muted-foreground truncate">{c.contactEmail}</div>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveContractor(c.id)}
                      disabled={removeContractor.isPending}
                      className="ml-3 p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
                      title="Entfernen"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Hinzufügen aus globalem AN-Pool */}
          {(() => {
            const linkedIds = new Set(contractors?.map(c => c.id) ?? []);
            const available = (allAnOrgs ?? []).filter(
              org => !linkedIds.has(org.id) &&
                (!contractorSearch || org.name.toLowerCase().includes(contractorSearch.toLowerCase()))
            );
            return (
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Hinzufügen
                </p>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <Input
                    placeholder="Nachunternehmer suchen…"
                    value={contractorSearch}
                    onChange={e => setContractorSearch(e.target.value)}
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                {available.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic py-2">
                    {contractorSearch ? 'Kein Treffer.' : allAnOrgs?.length === 0 ? 'Noch keine Nachunternehmer im System.' : 'Alle verfügbaren Nachunternehmer bereits verknüpft.'}
                  </p>
                ) : (
                  <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                    {available.map(org => (
                      <div key={org.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-border/60 hover:border-border bg-card/50 hover:bg-card transition-colors">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-7 h-7 rounded bg-muted flex items-center justify-center text-muted-foreground font-bold text-xs shrink-0">
                            {org.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{org.name}</div>
                            {org.contactEmail && <div className="text-[11px] text-muted-foreground truncate">{org.contactEmail}</div>}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-3 h-7 text-xs shrink-0"
                          onClick={() => handleAddContractor(org.id)}
                          disabled={addContractor.isPending}
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Verknüpfen
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      {/* ── Assign AN Dialog ────────────────────────────────────────────────── */}
      <Dialog open={isAssignAnOpen} onOpenChange={setIsAssignAnOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>AN zuordnen</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateAssignment} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nachunternehmen</Label>
              <Select name="anOrgId" required>
                <SelectTrigger>
                  <SelectValue placeholder="Wählen Sie ein Nachunternehmen..." />
                </SelectTrigger>
                <SelectContent>
                  {allAnOrgs?.map(org => (
                    <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Gewerk (optional)</Label>
                <Input name="trade" placeholder="z.B. Trockenbau" />
              </div>
              <div className="space-y-2">
                <Label>Arbeitspaket (optional)</Label>
                <Input name="workPackageReference" placeholder="z.B. AP-12" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Gültig ab (optional)</Label>
                <Input type="date" name="validFrom" />
              </div>
              <div className="space-y-2">
                <Label>Gültig bis (optional)</Label>
                <Input type="date" name="validTo" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select name="assignmentStatus" defaultValue="PLANNED" required>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLANNED">Geplant</SelectItem>
                  <SelectItem value="ACTIVE">Aktiv</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsAssignAnOpen(false)}>Abbrechen</Button>
              <Button type="submit" disabled={createAssignment.isPending}>Zuordnen</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Assignment Dialog ────────────────────────────────────────────────── */}
      <Dialog open={!!editAssignmentId} onOpenChange={(open) => { if (!open) setEditAssignmentId(null); }}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>AN-Zuordnung bearbeiten</DialogTitle>
          </DialogHeader>
          {(() => {
            const assignment = assignments?.find(a => a.id === editAssignmentId);
            if (!assignment) return null;
            return (
              <form onSubmit={handleUpdateAssignment} className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Nachunternehmen</Label>
                  <Input value={assignment.anName || 'Unbekannt'} disabled className="bg-muted" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Gewerk (optional)</Label>
                    <Input name="trade" defaultValue={assignment.trade || ''} />
                  </div>
                  <div className="space-y-2">
                    <Label>Arbeitspaket (optional)</Label>
                    <Input name="workPackageReference" defaultValue={assignment.workPackageReference || ''} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Gültig ab (optional)</Label>
                    <Input type="date" name="validFrom" defaultValue={assignment.validFrom ? assignment.validFrom.substring(0, 10) : ''} />
                  </div>
                  <div className="space-y-2">
                    <Label>Gültig bis (optional)</Label>
                    <Input type="date" name="validTo" defaultValue={assignment.validTo ? assignment.validTo.substring(0, 10) : ''} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select name="assignmentStatus" defaultValue={assignment.assignmentStatus} required>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PLANNED">Geplant</SelectItem>
                      <SelectItem value="ACTIVE">Aktiv</SelectItem>
                      <SelectItem value="INACTIVE">Inaktiv</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <DialogFooter className="mt-6">
                  <Button type="button" variant="outline" onClick={() => setEditAssignmentId(null)}>Abbrechen</Button>
                  <Button type="submit" disabled={updateAssignment.isPending}>Speichern</Button>
                </DialogFooter>
              </form>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
