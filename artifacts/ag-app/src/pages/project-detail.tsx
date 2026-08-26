import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link, useLocation } from 'wouter';
import NetzplanView from '@/components/NetzplanView';
import { format } from 'date-fns';
import {
  useGetProject,
  useListTakte,
  useCreateTakt,
  useUpdateTakt,
  useDeleteTakt,
  useListProjectContractors,
  useListTaktRequests,
  useCreateTaktRequestBatchWithSnapshot,
  useSendTaktRequest,
  useCreateGuDecision,
  useListTaktDependencies,
  useCreateTaktDependency,
  useDeleteTaktDependency,
  getTaktRequestDetail,
  getListTakteQueryKey,
  getListTaktRequestsQueryKey,
  getGetTaktRequestDetailQueryKey,
  getGetProjectQueryKey,
  getGetAgProjectsOverviewQueryKey,
  getListProjectContractorsQueryKey,
  useListProjectMemberships,
  useRevokeProjectMembership,
  useRetryProjectInvitationDelivery,
  getListProjectMembershipsQueryKey,
  getListTaktDependenciesQueryKey,
  TaktStatus,
  TaktLifecycleStatus,
  TaktDependencyType,
} from '@workspace/api-client-react';
import type { TaktDependency, TaktUpdateResult, RescheduledTakt, TaktRequestListItem, TaktRequestDetail, ProjectSubcontractorAssignment, TaktDependencyCreateResult, ProjectMembership, ProjectInvitationDelivery } from '@workspace/api-client-react';
import { useQuery, useQueryClient, useQueries } from '@tanstack/react-query';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { DatePicker } from '@/components/date-picker';

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
  AlertCircle, Building2, Globe, ArrowRightLeft, Settings2, ChevronRight,
  RefreshCw,
} from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
import { useAuth } from '@/contexts/auth-context';

import {
  useGetAgProjectOverview,
  useListProjectSubcontractors,
  useUpdateProjectSubcontractor,
  useDeactivateProjectSubcontractor,
  getListProjectSubcontractorsQueryKey,
  useGetProjectDataPublications,
  useSuspendDataPublication,
  useWithdrawDataPublication,
  useGetProjectCalendar,
  getGetProjectCalendarQueryKey,
  useUpdateProjectCalendar,
  useCreateTaktDependencySkipReschedule,
  useUpdateProject,
  type DataPublication,
  type ProjectCalendar,
} from '@workspace/api-client-react';
import { DataPublicationWizard } from '@/components/DataPublicationWizard';
import { ProjectInvitationWizard } from '@/components/ProjectInvitationWizard';
import { AlternativeImpactInfo } from '@/components/alternative-impact-info';
import { CoordinationBoard } from '@/components/coordination-board';
import { findAlternativeImpacts, type AlternativeImpact } from '@/lib/alternative-impact';
import {
  buildAssignablePartners,
  deduplicateDataPublications,
  getEligibleVergabePublications,
} from '@/lib/vergabe';

// ── Working-days client utility ────────────────────────────────────────────────

function clientComputePlannedEnd(
  plannedStart: string,
  durationDays: number,
  cal: ProjectCalendar,
): string {
  const hoursByDow = [
    Number(cal.sunHours), Number(cal.monHours), Number(cal.tueHours),
    Number(cal.wedHours), Number(cal.thuHours), Number(cal.friHours),
    Number(cal.satHours),
  ];
  const isWorkday = (d: Date) => hoursByDow[d.getDay()] > 0;
  const parts = plannedStart.split('-').map(Number);
  let cur = new Date(parts[0], parts[1] - 1, parts[2]);
  while (!isWorkday(cur)) cur.setDate(cur.getDate() + 1);
  const fullDays = Math.max(0, Math.ceil(durationDays) - 1);
  let remaining = fullDays;
  while (remaining > 0) {
    cur.setDate(cur.getDate() + 1);
    if (isWorkday(cur)) remaining--;
  }
  return `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
}

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
  taktLabelById: Map<string, string>,
  alternativeCountByTaktId: Map<string, number>,
  collapsedAlternativeTaktIds: Set<string>,
  onToggleAlternatives: (taktId: string) => void,
): React.FC<TaskListTableProps> {
  return function GanttListTable({ rowHeight, rowWidth, fontFamily, fontSize, tasks, selectedTaskId, setSelectedTask }) {
    return (
      <div style={{ fontFamily, fontSize, borderRight: '1px solid hsl(var(--border))' }}>
        {tasks.map((task, idx) => {
          const isAlt = task.id.startsWith('alt-');
          const lc = !isAlt ? (taktById.get(task.id)?.lifecycleStatus ?? null) : null;
          const lcColor = getLifecycleColor(lc as TaktLifecycleStatus | null);
          const lcLabel = lc ? (LIFECYCLE_LABEL[lc as TaktLifecycleStatus] ?? lc) : null;
          return (
            <div
              key={task.id}
              onClick={() => setSelectedTask(task.id)}
              style={{
                height: rowHeight, width: rowWidth,
                display: 'flex', alignItems: 'center',
                padding: isAlt ? '0 12px 0 28px' : '0 12px',
                gap: 6,
                cursor: 'pointer', userSelect: 'none',
                borderBottom: '1px solid hsl(var(--border) / 0.4)',
                borderLeft: isAlt ? '3px solid #f9731680' : undefined,
                background: task.id === selectedTaskId
                  ? 'hsl(var(--sidebar-accent))'
                  : isAlt
                    ? '#f9731410'
                    : idx % 2 === 0 ? 'hsl(var(--background))' : 'hsl(var(--card) / 0.6)',
                color: isAlt ? '#c2410c' : 'hsl(var(--foreground))',
              }}
            >
              {!isAlt && (alternativeCountByTaktId.get(task.id) ?? 0) > 0 ? (
                <button
                  type="button"
                  aria-label={collapsedAlternativeTaktIds.has(task.id) ? 'Alternativen einblenden' : 'Alternativen ausblenden'}
                  title={collapsedAlternativeTaktIds.has(task.id) ? 'Alternativen einblenden' : 'Alternativen ausblenden'}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleAlternatives(task.id);
                  }}
                  style={{
                    width: 16, height: 16, display: 'inline-flex', alignItems: 'center',
                    justifyContent: 'center', flexShrink: 0, border: 0, padding: 0,
                    background: 'transparent', color: '#c2410c', cursor: 'pointer',
                  }}
                >
                  {collapsedAlternativeTaktIds.has(task.id)
                    ? <ChevronRight size={13} />
                    : <ChevronDown size={13} />}
                </button>
              ) : !isAlt ? <span style={{ width: 16, flexShrink: 0 }} /> : null}
              {isAlt && (
                <span style={{ fontSize: '10px', opacity: 0.8, flexShrink: 0 }}>↩</span>
              )}
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontSize: '11px' }}>
                {isAlt ? task.name : (taktLabelById.get(task.id) ?? task.name)}
              </div>
              {isAlt ? (
                <span style={{
                  flexShrink: 0, fontSize: '9px', fontWeight: 600, lineHeight: 1,
                  padding: '2px 5px', borderRadius: 4,
                  background: '#f9731422', color: '#c2410c', border: '1px solid #f9731444',
                  whiteSpace: 'nowrap',
                }}>
                  Vorschlag
                </span>
              ) : lcLabel && lc !== 'PLANNED' ? (
                <span style={{
                  flexShrink: 0, fontSize: '9px', fontWeight: 600, lineHeight: 1,
                  padding: '2px 5px', borderRadius: 4,
                  background: lcColor + '22', color: lcColor, border: `1px solid ${lcColor}44`,
                  whiteSpace: 'nowrap',
                }}>
                  {lcLabel}
                </span>
              ) : null}
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
  const { user, hasRole } = useAuth();

  // Soft-enforce: if user has no roles (legacy/unassigned), allow all actions.
  // If user has roles, check that the right role is present.
  const canManageContractors = !user?.roles.length || hasRole('AG_ADMIN');
  const canManageTaktRequests = !user?.roles.length || hasRole('AG_ADMIN', 'GENERAL_PLANNER');

  const [, setLocation] = useLocation();

  const [activeChartTab, setActiveChartTab] = useState<'gantt' | 'netzplan' | 'an-zuordnungen' | 'kalender'>('gantt');
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Month);
  const [selectedTaktId, setSelectedTaktId] = useState<string | null>(null);
  const [showAlternatives, setShowAlternatives] = useState(true);
  const [collapsedAlternativeTaktIds, setCollapsedAlternativeTaktIds] = useState<Set<string>>(new Set());
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editTab, setEditTab] = useState<'details' | 'deps'>('details');

  // Inline Vergabe state in the info panel
  const [isVergabeOpen, setIsVergabeOpen] = useState(false);

  // Contractor management dialog
  const [isParticipantDirectoryOpen, setIsParticipantDirectoryOpen] = useState(false);

  // Dependency form state (shared between info panel read and edit dialog write)
  const [newDepPredecessorId, setNewDepPredecessorId] = useState('');
  const [newDepType, setNewDepType] = useState<TaktDependencyType>('EA');
  const [newDepLag, setNewDepLag] = useState(0);

  // Dependency reschedule prompt
  const [depRescheduleOpen, setDepRescheduleOpen] = useState(false);
  const [pendingDepData, setPendingDepData] = useState<{ predecessorId: string; successorId: string; type: TaktDependencyType; lagDays: number } | null>(null);
  const [ganttLinkMode, setGanttLinkMode] = useState(false);
  const [ganttLinkPredecessorId, setGanttLinkPredecessorId] = useState<string | null>(null);
  const [ganttLinkSuccessorId, setGanttLinkSuccessorId] = useState<string | null>(null);
  const [ganttLinkDialogOpen, setGanttLinkDialogOpen] = useState(false);
  const [ganttLinkType, setGanttLinkType] = useState<TaktDependencyType>('EA');
  const [ganttLinkLag, setGanttLinkLag] = useState(0);

  // Duration state — create form
  const [createDurationDays, setCreateDurationDays] = useState<string>('');
  const [createPlannedStart, setCreatePlannedStart] = useState('');
  const [createPlannedEnd, setCreatePlannedEnd] = useState('');

  // Dependency rows — create form
  const [createDeps, setCreateDeps] = useState<
    { _id: number; predecessorId: string; type: TaktDependencyType; lagDays: number }[]
  >([]);
  const [createDepCounter, setCreateDepCounter] = useState(0);

  // Duration state — edit form
  const [editDurationDays, setEditDurationDays] = useState<string>('');
  const [editPlannedStart, setEditPlannedStart] = useState('');
  const [editPlannedEnd, setEditPlannedEnd] = useState('');

  // Controlled field state — edit form (synced via useEffect whenever editTakt changes)
  const [editTaktBezeichnung, setEditTaktBezeichnung] = useState('');
  const [editZone, setEditZone] = useState('');
  const [editGewerk, setEditGewerk] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editEarliestStart, setEditEarliestStart] = useState('');
  const [editLatestEnd, setEditLatestEnd] = useState('');
  const [editInternalNote, setEditInternalNote] = useState('');
  const [editCostEstimate, setEditCostEstimate] = useState('');

  // Project edit dialog
  const [isEditProjectOpen, setIsEditProjectOpen] = useState(false);
  const [epName, setEpName] = useState('');
  const [epDescription, setEpDescription] = useState('');
  const [epLocation, setEpLocation] = useState('');
  const [epStartDate, setEpStartDate] = useState('');
  const [epEndDate, setEpEndDate] = useState('');
  const [epStatus, setEpStatus] = useState<'ACTIVE' | 'COMPLETED' | 'ARCHIVED'>('ACTIVE');

  // Sync edit-project form fields whenever the dialog is opened so that a
  // second open always reflects the latest saved values (defaultValue alone
  // won't re-initialize Radix Select after the first render).
  useEffect(() => {
    if (isEditProjectOpen) {
      setEpName(project?.projectName ?? '');
      setEpDescription(fullProject?.description ?? '');
      setEpLocation(fullProject?.location ?? '');
      setEpStartDate(project?.startDate?.slice(0, 10) ?? '');
      setEpEndDate(project?.endDate?.slice(0, 10) ?? '');
      setEpStatus((project?.status as 'ACTIVE' | 'COMPLETED' | 'ARCHIVED') ?? 'ACTIVE');
    }
  }, [isEditProjectOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Calendar config state
  const [calendarEditing, setCalendarEditing] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState<Record<string, string>>({});

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

  // Sync Takt edit form fields whenever the target takt changes or the dialog
  // opens/closes. Controlled inputs ensure stale defaultValues never surface
  // when the dialog stays mounted.
  useEffect(() => {
    const takt = takte?.find(t => t.id === editTargetId);
    if (!takt) return;
    setEditTaktBezeichnung(takt.taktBezeichnung ?? '');
    setEditZone(takt.zone ?? '');
    setEditGewerk(takt.gewerk ?? '');
    setEditDescription(takt.description ?? '');
    setEditPlannedStart(takt.plannedStart ?? '');
    setEditPlannedEnd(''); // clear computed end so plain plannedEnd is shown
    setEditDurationDays(''); // clear duration override on reopen
    setEditEarliestStart(takt.earliestStart ?? '');
    setEditLatestEnd(takt.latestEnd ?? '');
    setEditInternalNote((takt as any).internalNote ?? '');
    setEditCostEstimate((takt as any).costEstimate ?? '');
    setEditProcPriority((takt as any).procurementPriority ?? '');
    setEditRiskClass((takt as any).riskClassification ?? '');
  }, [editTargetId, isEditOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  // Intentionally omits `takte` so a background query refresh never wipes
  // in-progress edits. The dialog can only be opened after takte are loaded
  // (the user must click on a visible Takt), so the lookup succeeds on mount.

  const { data: contractors } = useListProjectContractors(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectContractorsQueryKey(projectId) },
  });
  const { data: memberships } = useListProjectMemberships(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectMembershipsQueryKey(projectId) },
  });
  const { data: allAnOrgs } = useQuery({
    queryKey: ['dataspace-participants', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const response = await fetch(
        `/api/dataspace/participants?organizationType=AN&projectId=${encodeURIComponent(projectId)}`,
      );
      if (!response.ok) {
        throw new Error('Nachunternehmer konnten nicht geladen werden.');
      }
      const participants = (await response.json()) as Array<{
        localOrgId: string;
        participantId: string;
        organizationName: string;
        identityStatus: string;
        connectorStatus: string;
        membershipStatus?: string | null;
        selectable?: boolean;
      }>;
      return participants.map((participant) => ({
        id: participant.localOrgId,
        name: participant.organizationName,
        contactEmail: null,
        participantId: participant.participantId,
        identityStatus: participant.identityStatus,
        connectorStatus: participant.connectorStatus,
        membershipStatus: participant.membershipStatus,
        selectable: participant.selectable,
      }));
    },
  });
  const { data: taktRequests } = useListTaktRequests(undefined, {
    query: { enabled: !!projectId, queryKey: getListTaktRequestsQueryKey() },
  });
  const { data: deps } = useListTaktDependencies(projectId, {
    query: { enabled: !!projectId, queryKey: getListTaktDependenciesQueryKey(projectId) },
  });
  const { data: assignments } = useListProjectSubcontractors(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectSubcontractorsQueryKey(projectId) },
  });

  // Full project data (includes description + location not in overview)
  const { data: fullProject } = useGetProject(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) },
  });

  // Project calendar — used for duration-based end-date computation
  const { data: projectCalendar } = useGetProjectCalendar(projectId, {
    query: { enabled: !!projectId, queryKey: getGetProjectCalendarQueryKey(projectId) },
  });
  const updateCalendar = useUpdateProjectCalendar();

  // Dataspace publications for this project
  const { data: dataPublications } = useGetProjectDataPublications(projectId);
  const suspendPublication = useSuspendDataPublication();
  const withdrawPublication = useWithdrawDataPublication();
  const visibleDataPublications = useMemo(
    () => deduplicateDataPublications(dataPublications ?? []),
    [dataPublications],
  );

  // Mutations
  const createTakt = useCreateTakt();
  const updateTakt = useUpdateTakt();
  const deleteTakt = useDeleteTakt();
  const createTaktRequestBatch = useCreateTaktRequestBatchWithSnapshot();
  const sendTaktRequest = useSendTaktRequest();
  const closeRequest = useCreateGuDecision();
  const revokeMembership = useRevokeProjectMembership();
  const retryInvitationDelivery = useRetryProjectInvitationDelivery();
  const createDep = useCreateTaktDependency();
  const createDepSkip = useCreateTaktDependencySkipReschedule();
  const deleteDep = useDeleteTaktDependency();
  
  const updateProject = useUpdateProject();
  const updateAssignment = useUpdateProjectSubcontractor();
  const deactivateAssignment = useDeactivateProjectSubcontractor();

  const [isDelegating, setIsDelegating] = useState(false);

  // Confirm-dialogs für destruktive Aktionen
  const [confirmDeleteTakt, setConfirmDeleteTakt] = useState(false);
  const [confirmRevokeMembership, setConfirmRevokeMembership] = useState<ProjectMembership | null>(null);
  const [confirmCloseRequest, setConfirmCloseRequest] = useState(false);
  const [confirmDeleteDep, setConfirmDeleteDep] = useState<string | null>(null);
  const [vergabeAnOrgIds, setVergabeAnOrgIds] = useState<string[]>([]);
  const [vergabePublicationId, setVergabePublicationId] = useState<string>('');
  const [vergabeResponseRequiredBy, setVergabeResponseRequiredBy] = useState<string>('');
  const [vergabeResponseRequiredByError, setVergabeResponseRequiredByError] = useState<string>('');

  const [editAssignmentId, setEditAssignmentId] = useState<string | null>(null);

  // Controlled state for the edit-assignment form — synced on open so reopening
  // always reflects the latest saved values (defaultValue is one-time-only).
  const [editTrade, setEditTrade] = useState('');
  const [editWorkPackageReference, setEditWorkPackageReference] = useState('');
  const [editValidFrom, setEditValidFrom] = useState('');
  const [editValidTo, setEditValidTo] = useState('');
  const [editAssignmentStatus, setEditAssignmentStatus] = useState<'PLANNED' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');

  // Sync edit-assignment form fields whenever the dialog opens OR when the
  // assignments query result refreshes while the dialog is already open (so an
  // immediate reopen after a save always reflects the just-persisted values).
  useEffect(() => {
    if (!editAssignmentId || !assignments) return;
    const a = assignments.find(x => x.id === editAssignmentId);
    if (a) {
      setEditTrade(a.trade || '');
      setEditWorkPackageReference(a.workPackageReference || '');
      setEditValidFrom(a.validFrom ? a.validFrom.substring(0, 10) : '');
      setEditValidTo(a.validTo ? a.validTo.substring(0, 10) : '');
      setEditAssignmentStatus((a.assignmentStatus as 'PLANNED' | 'ACTIVE' | 'INACTIVE') ?? 'ACTIVE');
    }
  }, [editAssignmentId, assignments]);

  // Dataspace publication wizard
  const [isDataspaceOpen, setIsDataspaceOpen] = useState(false);
  const [isInvitationPackageOpen, setIsInvitationPackageOpen] = useState(false);
  const [anStatusFilter, setAnStatusFilter] = useState<'ALL' | 'ACTIVE' | 'PLANNED' | 'INACTIVE'>('ALL');

  // Internal field state — create form
  const [createProcPriority, setCreateProcPriority] = useState<string>('');
  const [createRiskClass, setCreateRiskClass] = useState<string>('');

  // Internal field state — edit form (initialised when edit dialog opens)
  const [editProcPriority, setEditProcPriority] = useState<string>('');
  const [editRiskClass, setEditRiskClass] = useState<string>('');

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

  // The task list keeps the full Leistung designation while the Gantt bar
  // itself uses only the compact designation.
  const taktLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of takte ?? []) {
      map.set(t.id, t.taktBezeichnung);
    }
    return map;
  }, [takte]);

  // Stable tooltip component (recreated only when dep data changes)
  const GanttTooltip = useMemo(
    () => makeGanttTooltip(depsBySuccessor, taktNameById),
    [depsBySuccessor, taktNameById],
  );

  // Set of takt IDs that are currently in conflict
  const conflictTaktIdSet = useMemo(
    () => new Set(activeConflicts.map(c => c.takt.id)),
    [activeConflicts],
  );

  // TaktRequests with ALTERNATIVES_PROPOSED status for this project
  const proposalRequests = useMemo(
    () => (taktRequests ?? []).filter(
      r => r.status === 'ALTERNATIVES_PROPOSED' && r.projectId === projectId,
    ),
    [taktRequests, projectId],
  );

  // Batch-fetch detail for each proposal (typically 0–3 at a time)
  const proposalDetailResults = useQueries({
    queries: proposalRequests.map(r => ({
      queryKey: getGetTaktRequestDetailQueryKey(r.id),
      queryFn: () => getTaktRequestDetail(r.id),
      staleTime: 30_000,
      enabled: showAlternatives && proposalRequests.length > 0,
    })),
  });

  const proposalDetails = useMemo(
    () => proposalDetailResults.map(r => r.data).filter((d): d is TaktRequestDetail => !!d),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [proposalDetailResults.map(r => r.dataUpdatedAt).join(',')],
  );

  const alternativeCountByTaktId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const detail of proposalDetails) {
      const count = detail.response?.alternatives?.length ?? 0;
      if (count > 0) counts.set(detail.taktId, count);
    }
    return counts;
  }, [proposalDetails]);

  const toggleAlternativeGroup = useCallback((taktId: string) => {
    setCollapsedAlternativeTaktIds(previous => {
      const next = new Set(previous);
      if (next.has(taktId)) next.delete(taktId);
      else next.add(taktId);
      return next;
    });
  }, []);

  // Stable list table component (recreated when lifecycle/grouping state changes)
  const GanttListTable = useMemo(
    () => makeGanttListTable(
      taktById,
      taktLabelById,
      alternativeCountByTaktId,
      collapsedAlternativeTaktIds,
      toggleAlternativeGroup,
    ),
    [taktById, taktLabelById, alternativeCountByTaktId, collapsedAlternativeTaktIds, toggleAlternativeGroup],
  );

  const alternativeImpacts = useMemo(() => {
    const byAlternative = new Map<string, AlternativeImpact[]>();
    for (const detail of proposalDetails) {
      for (const alternative of detail.response?.alternatives ?? []) {
        byAlternative.set(
          `${detail.id}:${alternative.id}`,
          findAlternativeImpacts(
            detail.taktId,
            { proposedStart: alternative.proposedStart, proposedEnd: alternative.proposedEnd },
            takte ?? [],
            deps ?? [],
          ),
        );
      }
    }
    return byAlternative;
  }, [proposalDetails, takte, deps]);

  const allAlternativeImpacts = useMemo(
    () => [...alternativeImpacts.values()].flat(),
    [alternativeImpacts],
  );
  const impactedTaktIds = useMemo(
    () => new Set(allAlternativeImpacts.map(impact => impact.relatedTaktId)),
    [allAlternativeImpacts],
  );

  // Gantt tasks with dependency arrows + interleaved alternative bars
  const ganttTasks: Task[] = useMemo(() => {
    if (!takte || takte.length === 0) return [];

    const baseTasks = takte.map(takt => {
      const color = getTaktColor(takt.status);
      const predecessorIds = (depsBySuccessor.get(takt.id) ?? []).map(d => d.predecessorId);
        const isConflict = conflictTaktIdSet.has(takt.id);
        const isAlternativeImpact = impactedTaktIds.has(takt.id);
      return {
        id: takt.id,
         name: takt.kurzbezeichnung || takt.taktBezeichnung,
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
          : isAlternativeImpact
            ? {
                progressColor: '#d97706',
                progressSelectedColor: '#b45309',
                backgroundColor: '#f59e0b55',
                backgroundSelectedColor: '#f59e0b88',
              }
            : {
              progressColor: color,
              progressSelectedColor: color,
              backgroundColor: color + '80',
              backgroundSelectedColor: color + 'aa',
            },
      } satisfies Task;
    }).sort((a, b) => a.start.getTime() - b.start.getTime());

    if (!showAlternatives || proposalDetails.length === 0) return baseTasks;

    // Build map: taktId → alternative Task[]
    const altsByTaktId = new Map<string, Task[]>();
    const alternativeParentByTaskId = new Map<string, string>();
    for (const detail of proposalDetails) {
      if (!detail.response?.alternatives?.length) continue;
      const taktId = detail.taktId;
      const alts: Task[] = detail.response.alternatives.map(alt => ({
        id: `alt-${detail.id}-${alt.id}`,
        name: `Alt. ${alt.rank} — ${detail.nuOrgName}`,
        start: new Date(alt.proposedStart as string),
        end: new Date(alt.proposedEnd as string),
        type: 'task' as const,
        progress: 100,
        isDisabled: false,
        dependencies: [],
        styles: {
          progressColor: '#f97316',
          progressSelectedColor: '#ea6c00',
          backgroundColor: '#f9731438',
          backgroundSelectedColor: '#f9731460',
        },
      }));
      for (const alt of alts) alternativeParentByTaskId.set(alt.id, taktId);
      altsByTaktId.set(taktId, alts);
    }

    // Interleave: insert alt tasks immediately after their parent Takt row
    const combined: Task[] = [];
    for (const task of baseTasks) {
      combined.push(task);
      const alts = altsByTaktId.get(task.id);
      if (alts) combined.push(...alts);
    }
    return combined.filter(task =>
      !task.id.startsWith('alt-') ||
      !collapsedAlternativeTaktIds.has(alternativeParentByTaskId.get(task.id) ?? ''),
    );
  }, [takte, depsBySuccessor, conflictTaktIdSet, impactedTaktIds, showAlternatives, proposalDetails, collapsedAlternativeTaktIds]);

  const selectedTakt = useMemo(() => takte?.find(t => t.id === selectedTaktId), [takte, selectedTaktId]);
  const editTakt = useMemo(() => takte?.find(t => t.id === editTargetId), [takte, editTargetId]);

  // Active TaktRequest for the selected takt (info panel)
  const activeTaktRequest = useMemo<TaktRequestListItem | undefined>(() => {
    if (!taktRequests || !selectedTaktId) return undefined;
    return taktRequests
      .filter(
        r =>
          r.taktId === selectedTaktId &&
          r.status !== 'EXPIRED' &&
          r.status !== 'CANCELLED' &&
          r.status !== 'SUPERSEDED',
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }, [taktRequests, selectedTaktId]);

  const selectedProposalDetail = useMemo(
    () => proposalDetails.find(detail => detail.id === activeTaktRequest?.id),
    [proposalDetails, activeTaktRequest?.id],
  );

  // Group takt requests by nuOrgId, filtered to this project
  const projectRequestsByAnOrg = useMemo(() => {
    const map = new Map<string, TaktRequestListItem[]>();
    for (const r of (taktRequests ?? [])) {
      if (r.projectId !== projectId) continue;
      const list = map.get(r.nuOrgId) ?? [];
      list.push(r);
      map.set(r.nuOrgId, list);
    }
    return map;
  }, [taktRequests, projectId]);

  // Group assignments by anOrgId
  const assignmentsByAnOrg = useMemo(() => {
    const map = new Map<string, ProjectSubcontractorAssignment[]>();
    for (const a of (assignments ?? [])) {
      const list = map.get(a.anOrgId) ?? [];
      list.push(a);
      map.set(a.anOrgId, list);
    }
    return map;
  }, [assignments]);

  // A confirmed project membership is eligible for a Takt request even when
  // no separate fachliche assignment has been created yet.
  const assignablePartners = useMemo(
    () => buildAssignablePartners(assignments, memberships, allAnOrgs),
    [assignments, memberships, allAnOrgs],
  );

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

  /** Publications eligible for the current Vergabe form (TAKT_INFORMATION_PACKAGE, PUBLISHED,
   *  contains the selected takt, and the selected AN is a recipient). */
  const vergabePubs = useMemo(
    () => getEligibleVergabePublications(dataPublications, selectedTakt?.id, vergabeAnOrgIds),
    [dataPublications, selectedTakt, vergabeAnOrgIds],
  );

  function handleGanttClick(taskId: string) {
    if (taskId.startsWith('alt-')) {
      // alt-{requestId}-{altId} — navigate directly to the request detail
      const requestId = taskId.split('-').slice(1, -1).join('-');
      // requestId is a UUID (5 parts separated by -), altId is also a UUID
      // Pattern: alt-{uuid-5parts}-{uuid-5parts} → split on 'alt-' prefix, then take first UUID
      const parts = taskId.slice(4); // remove "alt-"
      const requestUuid = parts.slice(0, 36); // first UUID is 36 chars
      setLocation(`/leistungsanfragen/${requestUuid}`);
      return;
    }
    if (ganttLinkMode) {
      if (!ganttLinkPredecessorId) {
        setGanttLinkPredecessorId(taskId);
        return;
      }
      if (taskId === ganttLinkPredecessorId) {
        toast({
          title: 'Ungültige Auswahl',
          description: 'Vorgänger und Nachfolger müssen unterschiedliche Leistungen sein.',
          variant: 'destructive',
        });
        return;
      }
      setGanttLinkSuccessorId(taskId);
      setGanttLinkDialogOpen(true);
      return;
    }
    setLocation(`/projects/${projectId}/takte/${taskId}`);
  }

  function resetGanttLinkMode() {
    setGanttLinkMode(false);
    setGanttLinkPredecessorId(null);
    setGanttLinkSuccessorId(null);
    setGanttLinkDialogOpen(false);
    setGanttLinkType('EA');
    setGanttLinkLag(0);
  }

  function startGanttLink() {
    setGanttLinkPredecessorId(null);
    setGanttLinkSuccessorId(null);
    setGanttLinkType('EA');
    setGanttLinkLag(0);
    setGanttLinkMode(true);
  }

  function confirmGanttLink() {
    if (!ganttLinkPredecessorId || !ganttLinkSuccessorId) return;
    setPendingDepData({
      predecessorId: ganttLinkPredecessorId,
      successorId: ganttLinkSuccessorId,
      type: ganttLinkType,
      lagDays: ganttLinkLag,
    });
    setGanttLinkDialogOpen(false);
    setGanttLinkMode(false);
    setDepRescheduleOpen(true);
  }

  function handleOpenEdit() {
    if (!selectedTaktId) return;
    const takt = takte?.find(t => t.id === selectedTaktId);
    setEditTargetId(selectedTaktId);
    setSelectedTaktId(null);
    setIsVergabeOpen(false);
    setEditTab('details');
    setNewDepPredecessorId('');
    setNewDepLag(0);
    // Initialise controlled internal-field selects from current takt values
    setEditProcPriority((takt as any)?.procurementPriority ?? '');
    setEditRiskClass((takt as any)?.riskClassification ?? '');
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
        title: `${moved.length} Leistung${moved.length > 1 ? 'en' : ''} automatisch verschoben`,
        description: moved.map(t => t.taktBezeichnung).join(', '),
      });
    }
    if (conflicts.length > 0) {
      toast({
        variant: 'destructive',
        title: `${conflicts.length} Leistung${conflicts.length > 1 ? 'en' : ''} konnten nicht verschoben werden`,
        description: conflicts.map(c => `${c.takt.taktBezeichnung} (${STATUS_LABEL[c.takt.status as TaktStatus]}): erforderlich ab ${format(new Date(c.requiredStart), 'dd.MM.yyyy')}`).join(' · '),
      });
    }
    // Always update persistent conflict state (replace with latest result)
    setActiveConflicts(conflicts);
  }

  const handleCreateTakt = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const durVal = createDurationDays ? Number(createDurationDays) : undefined;
    const explicitEnd = (fd.get('plannedEnd') as string) || undefined;
    try {
      const newTakt = await createTakt.mutateAsync({
        projectId,
        data: {
          taktBezeichnung: fd.get('taktBezeichnung') as string,
          kurzbezeichnung: ((fd.get('kurzbezeichnung') as string) || '').trim(),
          zone: ((fd.get('zone') as string) || '').trim() || null,
          gewerk: fd.get('gewerk') as string,
          description: (fd.get('description') as string) || undefined,
          plannedStart: fd.get('plannedStart') as string,
          plannedEnd: durVal != null ? undefined : explicitEnd,
          durationDays: durVal,
          earliestStart: (fd.get('earliestStart') as string) || undefined,
          latestEnd: (fd.get('latestEnd') as string) || undefined,
          internalNote: (fd.get('internalNote') as string) || undefined,
          costEstimate: (fd.get('costEstimate') as string) || undefined,
          procurementPriority: (createProcPriority as any) || undefined,
          riskClassification: (createRiskClass as any) || undefined,
        } as any,
      });
      // Create any pre-defined dependencies (skip reschedule — Takt was just created)
      for (const dep of createDeps) {
        if (!dep.predecessorId) continue;
        await createDepSkip.mutateAsync({
          projectId,
          data: { predecessorId: dep.predecessorId, successorId: newTakt.id, type: dep.type, lagDays: dep.lagDays },
        });
      }
      toast({ title: 'Leistung angelegt', description: createDeps.length > 0 ? `${createDeps.length} Abhängigkeit${createDeps.length > 1 ? 'en' : ''} verknüpft` : undefined });
      invalidateTakte();
      setIsCreateOpen(false);
      setCreateProcPriority('');
      setCreateRiskClass('');
      setCreateDurationDays('');
      setCreatePlannedStart('');
      setCreatePlannedEnd('');
      setCreateDeps([]);
    } catch (err) {
      toast({ title: t('common.error'), description: (err as Error).message, variant: 'destructive' });
    }
  };

  const handleEditTakt = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editTargetId) return;
    const fd = new FormData(e.currentTarget);
    const durVal = editDurationDays ? Number(editDurationDays) : null;
    const explicitEnd = (fd.get('plannedEnd') as string) || undefined;
    updateTakt.mutate({
      projectId,
      taktId: editTargetId,
      data: {
        taktBezeichnung: fd.get('taktBezeichnung') as string,
        kurzbezeichnung: ((fd.get('kurzbezeichnung') as string) || '').trim(),
        zone: ((fd.get('zone') as string) || '').trim() || null,
        gewerk: fd.get('gewerk') as string,
        description: (fd.get('description') as string) || undefined,
        plannedStart: fd.get('plannedStart') as string,
        plannedEnd: durVal != null ? undefined : explicitEnd,
        durationDays: durVal,
        earliestStart: (fd.get('earliestStart') as string) || undefined,
        latestEnd: (fd.get('latestEnd') as string) || undefined,
        // GU-internal fields
        internalNote: (fd.get('internalNote') as string) || null,
        costEstimate: (fd.get('costEstimate') as string) || null,
        procurementPriority: (editProcPriority as any) || null,
        riskClassification: (editRiskClass as any) || null,
      } as any,
    }, {
      onSuccess: (result) => {
        toast({ title: 'Leistung gespeichert' });
        invalidateTakte();
        showRescheduleToasts(result.moved, result.conflicts);
        setIsEditOpen(false);
        setEditTargetId(null);
        setEditDurationDays('');
        setEditPlannedStart('');
        setEditPlannedEnd('');
      },
      onError: (err) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
    });
  };

  // TaktRequest is created + sent in two steps (snapshot → send)
  const handleDelegateTakt = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTakt || isDelegating) return;
    const fd = new FormData(e.currentTarget);
    const nuOrgIds = vergabeAnOrgIds;
    const message  = (fd.get('message') as string) || undefined;
    if (nuOrgIds.length === 0) {
      toast({ title: 'Nachunternehmer auswählen', description: 'Wählen Sie mindestens einen Nachunternehmer aus.', variant: 'destructive' });
      return;
    }
    if (!vergabePublicationId) {
      toast({
        title: 'Veröffentlichung erforderlich',
        description: 'Bitte wählen Sie eine Datenraum-Veröffentlichung aus.',
        variant: 'destructive',
      });
      return;
    }
    if (vergabeResponseRequiredBy) {
      const deadline = new Date(vergabeResponseRequiredBy);
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
      if (deadline < oneHourFromNow) {
        setVergabeResponseRequiredByError('Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen.');
        return;
      }
    }
    setIsDelegating(true);
    try {
      const created = await createTaktRequestBatch.mutateAsync({
        data: {
          taktId: selectedTakt.id,
          nuOrgIds,
          message,
          dataPublicationId: vergabePublicationId,
          ...(vergabeResponseRequiredBy
            ? { responseRequiredBy: new Date(vergabeResponseRequiredBy).toISOString() }
            : {}),
        },
      });
      await Promise.all(created.requests.map(requestItem =>
        sendTaktRequest.mutateAsync({ requestId: requestItem.id }),
      ));
      toast({
        title: nuOrgIds.length === 1 ? 'Anfrage gesendet' : 'Anfragen gesendet',
        description: nuOrgIds.length === 1 ? undefined : `${nuOrgIds.length} Nachunternehmer wurden parallel angefragt.`,
      });
      invalidateTakte();
      setIsVergabeOpen(false);
      setVergabeAnOrgIds([]);
      setVergabePublicationId('');
      setVergabeResponseRequiredBy('');
    } catch (err) {
      toast({ title: t('common.error'), description: (err as Error).message, variant: 'destructive' });
    } finally {
      setIsDelegating(false);
    }
  };

  const handleDeleteTakt = () => {
    setConfirmDeleteTakt(true);
  };

  const doDeleteTakt = () => {
    if (!editTargetId) return;
    deleteTakt.mutate({ projectId, taktId: editTargetId }, {
      onSuccess: () => {
        toast({ title: 'Leistung gelöscht' });
        invalidateTakte();
        setIsEditOpen(false);
        setEditTargetId(null);
        setConfirmDeleteTakt(false);
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
        setConfirmDeleteTakt(false);
      },
    });
  };

  const handleRevokeMembership = (membership: ProjectMembership) => {
    setConfirmRevokeMembership(membership);
  };

  const doRevokeMembership = () => {
    if (!confirmRevokeMembership) return;
    revokeMembership.mutate({ id: confirmRevokeMembership.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProjectMembershipsQueryKey(projectId) });
        toast({ title: 'Projektmitgliedschaft widerrufen' });
        setConfirmRevokeMembership(null);
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
        setConfirmRevokeMembership(null);
      },
    });
  };

  const handleRetryInvitationDelivery = (delivery: ProjectInvitationDelivery) => {
    retryInvitationDelivery.mutate({ messageId: delivery.messageId }, {
      onSuccess: (result) => {
        if (result.status === 'FAILED') {
          toast({
            title: 'Zustellung fehlgeschlagen',
            description: result.error?.message ?? 'Die Einladung konnte nicht zugestellt werden.',
            variant: 'destructive',
          });
          return;
        }
        toast({ title: 'Zustellung erneut angestoßen' });
      },
      onError: (err) => {
        // ApiError preserves the backend's business message, including the
        // retry-exhausted explanation, so it must not be replaced by a
        // generic success notification.
        toast({
          title: 'Zustellung konnte nicht wiederholt werden',
          description: (err as Error).message,
          variant: 'destructive',
        });
      },
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: getListProjectMembershipsQueryKey(projectId) });
      },
    });
  };

  const handleCloseRequest = () => {
    setConfirmCloseRequest(true);
  };

  const doCloseRequest = () => {
    if (!activeTaktRequest) return;
    closeRequest.mutate({
      requestId: activeTaktRequest.id,
      data: { decisionType: 'CLOSE_WITHOUT_AGREEMENT' },
    }, {
      onSuccess: () => {
         toast({ title: 'Anfrage zurückgezogen' });
        invalidateTakte();
        setConfirmCloseRequest(false);
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: (err as Error).message, variant: 'destructive' });
        setConfirmCloseRequest(false);
      },
    });
  };

  // Add dependency — only callable from the edit dialog
  // Shows a reschedule-confirmation dialog first; actual mutation runs in the handlers below.
  const handleAddDependency = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editTargetId || !newDepPredecessorId) return;
    setPendingDepData({
      predecessorId: newDepPredecessorId,
      successorId: editTargetId,
      type: newDepType,
      lagDays: newDepLag,
    });
    setDepRescheduleOpen(true);
  };

  const executeDepCreate = (skip: boolean) => {
    if (!pendingDepData) return;
    const mutateOpts = {
      onSuccess: (result: TaktDependencyCreateResult) => {
        toast({ title: 'Abhängigkeit angelegt' });
        invalidateTakte();
        showRescheduleToasts(result.moved as any, result.conflicts);
        setNewDepPredecessorId('');
        setNewDepLag(0);
        setPendingDepData(null);
      },
      onError: (err: Error) => {
        toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
        setPendingDepData(null);
      },
    };
    if (skip) {
      createDepSkip.mutate({ projectId, data: pendingDepData }, mutateOpts as any);
    } else {
      createDep.mutate({ projectId, data: pendingDepData }, mutateOpts as any);
    }
  };

  const handleDeleteDependency = (depId: string) => {
    setConfirmDeleteDep(depId);
  };

  const doDeleteDependency = () => {
    if (!confirmDeleteDep) return;
    deleteDep.mutate({ projectId, depId: confirmDeleteDep }, {
      onSuccess: (result) => {
        toast({ title: 'Abhängigkeit gelöscht' });
        invalidateTakte();
        showRescheduleToasts(result.moved, result.conflicts);
        setConfirmDeleteDep(null);
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
        setConfirmDeleteDep(null);
      },
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

  const handleUpdateAssignment = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editAssignmentId) return;
    updateAssignment.mutate({
      projectId,
      assignmentId: editAssignmentId,
      data: {
        trade: editTrade || undefined,
        workPackageReference: editWorkPackageReference || undefined,
        validFrom: editValidFrom || undefined,
        validTo: editValidTo || undefined,
        assignmentStatus: editAssignmentStatus,
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
    <div className="space-y-6 animate-in fade-in duration-500 min-h-full pb-8">
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
              <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'}>
                {project.status === 'ACTIVE' ? 'Aktiv' : project.status === 'COMPLETED' ? 'Abgeschlossen' : project.status === 'ARCHIVED' ? 'Archiviert' : project.status}
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                onClick={() => setIsEditProjectOpen(true)}
                title="Projektdaten bearbeiten"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center">
                <Calendar className="w-3.5 h-3.5 mr-1" />
                {project.startDate ? format(new Date(project.startDate), 'dd.MM.yyyy') : 'TBD'} –{' '}
                {project.endDate ? format(new Date(project.endDate), 'dd.MM.yyyy') : 'TBD'}
              </span>
              {fullProject?.location && (
                <span className="flex items-center">
                  <MapPin className="w-3.5 h-3.5 mr-1" />
                  {fullProject.location}
                </span>
              )}
            </div>
            {fullProject?.description && (
              <p className="mt-1 text-sm text-muted-foreground max-w-prose">
                {fullProject.description}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/projects/${projectId}/proposals`}>
            <Button variant="outline" className="relative">
              {(projectOverview.coordination.pendingProposals ?? 0) > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary" />
                </span>
              )}
              <AlignLeft className="w-4 h-4 mr-2" />
              {t('projects.proposals')}
            </Button>
          </Link>
          {canManageContractors && (
          <Button onClick={() => setIsInvitationPackageOpen(true)}>
            <Users className="w-4 h-4 mr-2" />
            Einladung & Freigabe
          </Button>
          )}
          {canManageContractors && (
          <Button variant="outline" onClick={() => setIsParticipantDirectoryOpen(true)}>
            <Users className="w-4 h-4 mr-2" />
             Projektpartner
            {memberships && memberships.length > 0 && (
              <span className="ml-1.5 text-xs bg-primary/15 text-primary rounded-full px-1.5 py-0.5 font-semibold">
                {memberships.filter(m => m.status === 'ACTIVE').length}
              </span>
            )}
          </Button>
          )}
          {canManageTaktRequests && (
            <Button variant="outline" onClick={() => setIsDataspaceOpen(true)}>
              <Globe className="w-4 h-4 mr-2" />
              Weitere Datenfreigabe
            </Button>
          )}
        </div>
      </div>

      {/* KPI Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="bg-card">
          <CardContent className="p-4 flex flex-col items-center text-center">
            <span className="text-xs font-medium text-muted-foreground mb-1 uppercase tracking-wider">Leistungen gesamt</span>
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

      <details className="rounded-xl border border-border bg-card overflow-hidden">
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-sm flex items-center justify-between hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4 text-primary" />Koordination</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform details-chevron" />
        </summary>
        <div className="border-t border-border/60 p-3">
          <CoordinationBoard projectId={projectId} />
        </div>
      </details>

      {/* ── Datenraum Bereitstellungen ─────────────────────────────────────── */}
      {visibleDataPublications.length > 0 && (
        <details className="rounded-xl border border-border bg-card overflow-hidden">
          <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-sm flex items-center justify-between hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-2"><Globe className="h-4 w-4 text-primary" />Datenraum <span className="text-xs text-muted-foreground">({visibleDataPublications.length})</span></span>
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          </summary>
        <div className="border-t border-border/60">
          <div className="divide-y divide-border/50">
            {visibleDataPublications.map((pub: DataPublication) => {
              const statusColors: Record<string, string> = {
                PUBLISHED: 'text-emerald-600 dark:text-emerald-400',
                DRAFT: 'text-muted-foreground',
                SUSPENDED: 'text-amber-600 dark:text-amber-400',
                WITHDRAWN: 'text-red-500 dark:text-red-400',
                EXPIRED: 'text-muted-foreground',
              };
              const statusLabels: Record<string, string> = {
                PUBLISHED: 'Veröffentlicht',
                DRAFT: 'Entwurf',
                SUSPENDED: 'Pausiert',
                WITHDRAWN: 'Zurückgezogen',
                EXPIRED: 'Abgelaufen',
              };
              const productLabels: Record<string, string> = {
                PROJECT_OVERVIEW: 'Projektübersicht',
                PROJECT_COORDINATION_PACKAGE: 'Koordinationspaket',
                TAKT_INFORMATION_PACKAGE: 'Leistungsinformationspaket',
              };
              const accepted = (pub.recipients ?? []).filter(r => r.status === 'ACCEPTED').length;
              const total = (pub.recipients ?? []).length;
              return (
                <div key={pub.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{pub.title}</span>
                      <span className="text-[10px] text-muted-foreground">v{pub.version}</span>
                      <span className={`text-[11px] font-medium ${statusColors[pub.status] ?? 'text-muted-foreground'}`}>
                        {statusLabels[pub.status] ?? pub.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
                      <span>{productLabels[pub.dataProductType] ?? pub.dataProductType}</span>
                      {pub.policyCode && <span>· {pub.policyCode}</span>}
                      <span>· {accepted}/{total} Akzeptiert</span>
                      {pub.publishedAt && (
                        <span>· {new Date(pub.publishedAt).toLocaleDateString('de-DE')}</span>
                      )}
                    </div>
                  </div>
                  {pub.status === 'PUBLISHED' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-amber-600 hover:text-amber-700 h-7"
                      onClick={() => suspendPublication.mutate(pub.id, {
                        onSuccess: () => toast({ title: 'Bereitstellung pausiert' }),
                        onError: (e) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
                      })}
                    >
                      Pausieren
                    </Button>
                  )}
                  {['PUBLISHED', 'SUSPENDED'].includes(pub.status) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs text-red-500 hover:text-red-600 h-7"
                      onClick={() => {
                        if (confirm('Bereitstellung zurückziehen? Diese Aktion kann nicht rückgängig gemacht werden.')) {
                          withdrawPublication.mutate(pub.id, {
                            onSuccess: () => toast({ title: 'Bereitstellung zurückgezogen' }),
                            onError: (e) => toast({ title: 'Fehler', description: e.message, variant: 'destructive' }),
                          });
                        }
                      }}
                    >
                      Zurückziehen
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        </details>
      )}

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
      <details open className="rounded-xl border border-border bg-card overflow-hidden">
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-sm flex items-center justify-between hover:bg-muted/30 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" />Bauablaufplanung</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </summary>
      <div className="bg-card border-t border-border/60 overflow-hidden flex flex-col min-h-[620px]">
        {/* Tab header */}
        <div className="border-b border-border px-4 bg-background flex flex-wrap items-center justify-between shrink-0 gap-y-0">
          <div className="flex items-center gap-1 h-12 overflow-x-auto min-w-0">
            <button
              onClick={() => setActiveChartTab('gantt')}
              className={`flex items-center gap-1.5 h-full px-3 text-sm font-medium border-b-2 transition-colors ${
                activeChartTab === 'gantt'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <AlignLeft className="w-4 h-4" />
              Gantt
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
              onClick={() => setActiveChartTab('an-zuordnungen')}
              className={`flex items-center gap-1.5 h-full px-3 text-sm font-medium border-b-2 transition-colors ${
                activeChartTab === 'an-zuordnungen'
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
            <button
              onClick={() => setActiveChartTab('kalender')}
              className={`flex items-center gap-1.5 h-full px-3 text-sm font-medium border-b-2 transition-colors ${
                activeChartTab === 'kalender'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Settings2 className="w-4 h-4" />
              Kalender
            </button>
          </div>

          {/* Tab-level actions — shown for Gantt and Netzplan */}
          {(activeChartTab === 'gantt' || activeChartTab === 'netzplan') && (
            <Button size="sm" onClick={() => setIsCreateOpen(true)} className="shrink-0 my-1.5">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Neue Leistung
            </Button>
          )}

          {/* Gantt controls — only shown on Gantt tab */}
          {activeChartTab === 'gantt' && (
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant={ganttLinkMode ? 'default' : 'outline'}
                onClick={ganttLinkMode ? resetGanttLinkMode : startGanttLink}
                className="h-8 text-xs"
                title="Zwei Leistungen im Gantt miteinander verknüpfen"
              >
                <Link2 className="w-3.5 h-3.5 mr-1.5" />
                {ganttLinkMode ? 'Verknüpfen abbrechen' : 'Abhängigkeit verknüpfen'}
              </Button>
              {/* Alternativvorschläge toggle */}
              {proposalRequests.length > 0 && (
                <button
                  onClick={() => setShowAlternatives(v => !v)}
                  className={`flex items-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border transition-colors ${
                    showAlternatives
                      ? 'bg-orange-500/10 border-orange-400/40 text-orange-700'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
                  }`}
                  title={showAlternatives ? 'Alternativvorschläge ausblenden' : 'Alternativvorschläge einblenden'}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  {proposalRequests.length} Gegenvorschlag{proposalRequests.length !== 1 ? 'schläge' : ''}
                </button>
              )}
              <Select value={viewMode} onValueChange={(val) => setViewMode(val as ViewMode)}>
                <SelectTrigger className="w-full sm:w-[120px] h-8 text-xs">
                  <SelectValue placeholder="Ansicht" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ViewMode.Day}>Tag</SelectItem>
                  <SelectItem value={ViewMode.Week}>Woche</SelectItem>
                  <SelectItem value={ViewMode.Month}>Monat</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            {allAlternativeImpacts.length > 0 && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-lg border border-orange-500/35 bg-orange-500/8 text-sm shrink-0">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
                <div className="min-w-0">
                  <p className="font-semibold text-orange-700 dark:text-orange-300 mb-1">
                    Gegenvorschläge beeinflussen die Abhängigkeitskette
                  </p>
                  <p className="text-xs text-orange-700/90 dark:text-orange-200/90">
                    {allAlternativeImpacts.filter(impact => impact.direction === 'PREDECESSOR').length > 0
                      ? `${allAlternativeImpacts.filter(impact => impact.direction === 'PREDECESSOR').length} Vorgänger`
                      : ''}
                    {allAlternativeImpacts.some(impact => impact.direction === 'PREDECESSOR') &&
                      allAlternativeImpacts.some(impact => impact.direction === 'SUCCESSOR') ? ' und ' : ''}
                    {allAlternativeImpacts.filter(impact => impact.direction === 'SUCCESSOR').length > 0
                      ? `${allAlternativeImpacts.filter(impact => impact.direction === 'SUCCESSOR').length} Nachfolger`
                      : ''}{' '}
                    haben keinen ausreichenden Puffer. Betroffene Balken sind orange markiert.
                  </p>
                </div>
              </div>
            )}
            {takteLoading ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">Lade Plan…</div>
            ) : ganttTasks.length > 0 ? (
              <div className={`rounded-lg border overflow-hidden bg-card text-card-foreground ${ganttLinkMode ? 'border-primary/60 ring-2 ring-primary/10' : 'border-border'}`}>
                {ganttLinkMode && (
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-primary/20 bg-primary/5 text-sm">
                    <Link2 className="w-4 h-4 text-primary shrink-0" />
                    <span>
                      {ganttLinkPredecessorId
                        ? 'Jetzt die Nachfolger-Leistung anklicken.'
                        : 'Zuerst die Vorgänger-Leistung anklicken.'}
                    </span>
                    <button
                      type="button"
                      onClick={resetGanttLinkMode}
                      className="ml-auto text-xs text-muted-foreground hover:text-foreground underline"
                    >
                      Abbrechen
                    </button>
                  </div>
                )}
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
                <h3 className="font-medium text-lg">Noch keine Leistungen geplant</h3>
                <p className="text-muted-foreground text-sm max-w-sm mt-1">
                  Legen Sie Leistungen an, um Ihren Projektablauf zu strukturieren.
                </p>
                <Button onClick={() => setIsCreateOpen(true)} className="mt-6">
                  <Plus className="w-4 h-4 mr-2" />
                  Erste Leistung anlegen
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
              <NetzplanView
                takte={takte ?? []}
                deps={deps ?? []}
                alternativeImpacts={allAlternativeImpacts}
              />
            )}
          </div>
        )}

        {/* ── AN-Zuordnungen panel ──────────────────────────────────────── */}
        {activeChartTab === 'an-zuordnungen' && (() => {
          const assignmentStatusLabel: Record<string, string> = {
            ACTIVE: 'Aktiv', PLANNED: 'Geplant', INACTIVE: 'Inaktiv',
            COMPLETED: 'Abgeschlossen', CANCELLED: 'Storniert',
          };
          const assignmentStatusClass: Record<string, string> = {
            ACTIVE: 'bg-green-500/15 text-green-700 dark:text-green-400',
            PLANNED: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
            INACTIVE: 'bg-muted text-muted-foreground',
            COMPLETED: 'bg-muted text-muted-foreground',
            CANCELLED: 'bg-destructive/10 text-destructive',
          };
          const requestStatusLabel: Record<string, string> = {
            DRAFT: 'Entwurf', SENT: 'Gesendet', DELIVERED: 'Zugestellt',
            DETAILS_RETRIEVED: 'Abgerufen', UNDER_REVIEW: 'In Prüfung',
            ACCEPTED: 'Angenommen', ALTERNATIVES_PROPOSED: 'Gegenvorschlag',
            REJECTED: 'Abgelehnt', REVISION_REQUIRED: 'Revision',
            CANCELLED: 'Storniert', EXPIRED: 'Abgelaufen', SUPERSEDED: 'Ersetzt',
          };
          const requestStatusClass: Record<string, string> = {
            DRAFT: 'bg-muted text-muted-foreground',
            SENT: 'bg-blue-500/12 text-blue-700 dark:text-blue-400',
            DELIVERED: 'bg-blue-500/12 text-blue-700 dark:text-blue-400',
            DETAILS_RETRIEVED: 'bg-blue-500/12 text-blue-700 dark:text-blue-400',
            UNDER_REVIEW: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
            ACCEPTED: 'bg-green-500/15 text-green-700 dark:text-green-400',
            ALTERNATIVES_PROPOSED: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
            REJECTED: 'bg-destructive/10 text-destructive',
            REVISION_REQUIRED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
            CANCELLED: 'bg-muted text-muted-foreground',
            EXPIRED: 'bg-muted text-muted-foreground',
            SUPERSEDED: 'bg-muted text-muted-foreground',
          };

           // Show confirmed project partners even before a separate fachliche
           // assignment exists. Membership and assignment are intentionally
           // different domain objects: acceptance creates the former, while
           // "Leistung vergeben" requires an ACTIVE assignment.
          const seenOrgIds = new Set<string>();
          const uniqueAnOrgs: string[] = [];
          for (const a of (assignments ?? [])) {
            if (!seenOrgIds.has(a.anOrgId)) {
              seenOrgIds.add(a.anOrgId);
              uniqueAnOrgs.push(a.anOrgId);
            }
          }
           for (const membership of (memberships ?? [])) {
             if (membership.status !== 'ACTIVE' || seenOrgIds.has(membership.anOrgId)) continue;
             seenOrgIds.add(membership.anOrgId);
             uniqueAnOrgs.push(membership.anOrgId);
           }
          return (
            <div className="flex-1 overflow-auto p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm text-muted-foreground">
                  Zuordnungen und Anfragen pro Nachunternehmen
                </p>
                <Button size="sm" onClick={() => setIsInvitationPackageOpen(true)}>
                  <Users className="w-4 h-4 mr-1.5" />
                  Zum Projekt einladen
                </Button>
              </div>

              {uniqueAnOrgs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                  <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                    <Users className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <h3 className="font-medium text-base mb-1">Noch keine Nachunternehmen zugeordnet</h3>
                  <p className="text-sm text-muted-foreground max-w-xs mb-5">
                    Laden Sie einen Nachunternehmer ein. Nach der Zustimmung wird er als Projektpartner verfügbar.
                  </p>
                  <Button size="sm" onClick={() => setIsInvitationPackageOpen(true)}>
                    <Users className="w-4 h-4 mr-1.5" />
                    Zum Projekt einladen
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {uniqueAnOrgs.map(anOrgId => {
                    const anAssignments = assignmentsByAnOrg.get(anOrgId) ?? [];
                    const anRequests = (projectRequestsByAnOrg.get(anOrgId) ?? [])
                      .filter(r => r.status !== 'SUPERSEDED')
                      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
                     const anName = anAssignments[0]?.anName
                       ?? allAnOrgs?.find(candidate => candidate.id === anOrgId)?.name
                       ?? anOrgId;
                     const membership = memberships?.find(
                       candidate => candidate.anOrgId === anOrgId && candidate.status === 'ACTIVE',
                     );
                    const activeCount = anAssignments.filter(a => a.assignmentStatus === 'ACTIVE').length;

                    return (
                      <div key={anOrgId} className="rounded-lg border border-border bg-card overflow-hidden">
                        {/* Card header */}
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <Building2 className="w-4 h-4 text-primary" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{anName}</p>
                              <p className="text-xs text-muted-foreground">
                                {activeCount > 0
                                  ? `${activeCount} aktive Zuordnung${activeCount !== 1 ? 'en' : ''}`
                                   : membership ? 'Projektpartner · noch keine Zuordnung' : 'Keine aktiven Zuordnungen'}
                                {anRequests.length > 0 && ` · ${anRequests.length} Anfrage${anRequests.length !== 1 ? 'n' : ''}`}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Assignments */}
                        <div className="px-4 pt-3 pb-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Zuordnungen
                          </p>
                           <div className="flex flex-col gap-1.5">
                             {anAssignments.length === 0 && membership && (
                               <div className="rounded-md border border-dashed border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-muted-foreground">
                                 Einladung angenommen. Für eine Leistungsanfrage muss noch eine fachliche Zuordnung angelegt werden.
                               </div>
                             )}
                             {anAssignments.map(a => (
                              <div key={a.id} className="flex items-center gap-2 text-sm">
                                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${assignmentStatusClass[a.assignmentStatus] ?? 'bg-muted text-muted-foreground'}`}>
                                  {assignmentStatusLabel[a.assignmentStatus] ?? a.assignmentStatus}
                                </span>
                                <span className="text-muted-foreground shrink-0">
                                  {a.trade || <span className="italic opacity-60">Alle Gewerke</span>}
                                </span>
                                {a.workPackageReference && (
                                  <>
                                    <span className="text-border">·</span>
                                    <span className="text-muted-foreground text-xs">{a.workPackageReference}</span>
                                  </>
                                )}
                                <span className="text-border mx-1">·</span>
                                <span className="text-xs text-muted-foreground">
                                  {a.validFrom ? format(new Date(a.validFrom), 'dd.MM.yy') : '–'}
                                  {' – '}
                                  {a.validTo ? format(new Date(a.validTo), 'dd.MM.yy') : 'offen'}
                                </span>
                                <div className="ml-auto flex items-center gap-0.5">
                                  <Button size="icon" variant="ghost" className="h-6 w-6" title="Bearbeiten"
                                    onClick={() => setEditAssignmentId(a.id)}>
                                    <Pencil className="w-3 h-3" />
                                  </Button>
                                  {(a.assignmentStatus === 'ACTIVE' || a.assignmentStatus === 'PLANNED') && (
                                    <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                                      title="Deaktivieren" onClick={() => handleDeactivateAssignment(a.id)}>
                                      <XCircle className="w-3 h-3" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* TaktRequests */}
                        <div className="px-4 pb-3 pt-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-1">
                            Anfragen
                          </p>
                          {anRequests.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">Noch keine Anfragen für dieses Projekt</p>
                          ) : (
                            <div className="rounded-md border border-border overflow-hidden">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border bg-muted/30">
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Vorgang</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Gewerk</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Termin</th>
                                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                                    <th className="px-3 py-2" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {anRequests.map((r, idx) => {
                                    const taktInfo = takte?.find(t => t.id === r.taktId);
                                    return (
                                    <tr key={r.id}
                                      className={`border-b border-border/60 last:border-0 ${idx % 2 === 0 ? '' : 'bg-muted/10'}`}>
                                      <td className="px-3 py-2 font-medium">{r.taktBezeichnung}</td>
                                      <td className="px-3 py-2 text-muted-foreground">{taktInfo?.gewerk ?? '–'}</td>
                                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                                        {taktInfo?.plannedStart && taktInfo?.plannedEnd
                                          ? `${format(new Date(taktInfo.plannedStart), 'dd.MM.yy')} – ${format(new Date(taktInfo.plannedEnd), 'dd.MM.yy')}`
                                          : '–'}
                                      </td>
                                      <td className="px-3 py-2">
                                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${requestStatusClass[r.status] ?? 'bg-muted text-muted-foreground'}`}>
                                          {requestStatusLabel[r.status] ?? r.status}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <button
                                          onClick={() => setLocation(`/leistungsanfragen/${r.id}`)}
                                          className="text-primary hover:underline text-xs font-medium"
                                        >
                                          Öffnen →
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}
        {/* ── Kalender panel ────────────────────────────────────────────── */}
        {activeChartTab === 'kalender' && (() => {
          const cal = projectCalendar;
          const WEEKDAYS: Array<{ key: keyof ProjectCalendar; label: string; short: string }> = [
            { key: 'monHours', label: 'Montag',     short: 'Mo' },
            { key: 'tueHours', label: 'Dienstag',   short: 'Di' },
            { key: 'wedHours', label: 'Mittwoch',   short: 'Mi' },
            { key: 'thuHours', label: 'Donnerstag', short: 'Do' },
            { key: 'friHours', label: 'Freitag',    short: 'Fr' },
            { key: 'satHours', label: 'Samstag',    short: 'Sa' },
            { key: 'sunHours', label: 'Sonntag',    short: 'So' },
          ];
          const draft = calendarEditing ? calendarDraft : (cal ? Object.fromEntries(WEEKDAYS.map(w => [w.key, String(cal[w.key])])) : {});
          return (
            <div className="flex-1 overflow-auto p-6">
              <div className="max-w-lg mx-auto space-y-6">
                <div>
                  <h2 className="text-base font-semibold flex items-center gap-2 mb-1">
                    <Settings2 className="w-4 h-4 text-primary" />
                    Projektwochenkalender
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Legen Sie fest, wie viele Arbeitsstunden pro Wochentag im Projekt zur Verfügung stehen.
                    0 Stunden = kein Arbeitstag. Die Werte werden genutzt, um aus einer Dauer in Arbeitstagen das Plan-Ende zu berechnen.
                  </p>
                </div>

                <div className="rounded-xl border border-border bg-card overflow-hidden">
                  <div className="grid grid-cols-7 divide-x divide-border border-b border-border bg-muted/30">
                    {WEEKDAYS.map(w => (
                      <div key={w.key} className="flex flex-col items-center py-2 px-1">
                        <span className="text-xs font-semibold text-muted-foreground">{w.short}</span>
                        <span className="text-[10px] text-muted-foreground/60 hidden sm:block">{w.label.slice(0, 2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 divide-x divide-border">
                    {WEEKDAYS.map(w => {
                      const hours = calendarEditing ? (draft[w.key] ?? '0') : (cal ? String(cal[w.key]) : '8');
                      const isWorkday = Number(hours) > 0;
                      return (
                        <div key={w.key} className={`flex flex-col items-center py-4 px-2 gap-2 ${!isWorkday && !calendarEditing ? 'bg-muted/30' : ''}`}>
                          {calendarEditing ? (
                            <Input
                              type="number"
                              min={0}
                              max={24}
                              step={0.5}
                              value={draft[w.key] ?? '0'}
                              onChange={e => setCalendarDraft(d => ({ ...d, [w.key]: e.target.value }))}
                              className="h-9 w-full text-center text-sm font-semibold px-1"
                            />
                          ) : (
                            <span className={`text-lg font-bold ${isWorkday ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                              {hours}
                            </span>
                          )}
                          {!calendarEditing && (
                            <span className={`text-[10px] ${isWorkday ? 'text-primary' : 'text-muted-foreground/40'}`}>
                              {isWorkday ? 'Arbeitstag' : 'Frei'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex gap-3 justify-end">
                  {calendarEditing ? (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => { setCalendarEditing(false); setCalendarDraft({}); }}
                        disabled={updateCalendar.isPending}
                      >
                        Abbrechen
                      </Button>
                      <Button
                        onClick={() => {
                          const data = Object.fromEntries(
                            WEEKDAYS.map(w => [w.key, Number(draft[w.key] ?? 0)])
                          );
                          updateCalendar.mutate({ projectId, data: data as any }, {
                            onSuccess: () => {
                              toast({ title: 'Kalender gespeichert' });
                              queryClient.invalidateQueries({ queryKey: getGetProjectCalendarQueryKey(projectId) });
                              setCalendarEditing(false);
                              setCalendarDraft({});
                            },
                            onError: (err) => toast({ title: 'Fehler', description: err.message, variant: 'destructive' }),
                          });
                        }}
                        disabled={updateCalendar.isPending}
                      >
                        {updateCalendar.isPending ? 'Speichere…' : 'Kalender speichern'}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCalendarDraft(Object.fromEntries(WEEKDAYS.map(w => [w.key, String(cal ? cal[w.key] : w.key.startsWith('sat') || w.key.startsWith('sun') ? '0' : '8')])));
                        setCalendarEditing(true);
                      }}
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Kalender bearbeiten
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

      </div>
      </details>

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
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

                {/* Internal fields read-only display */}
                {((selectedTakt as any).internalNote || (selectedTakt as any).costEstimate || (selectedTakt as any).procurementPriority || (selectedTakt as any).riskClassification) && (
                  <Card className="border-amber-500/20 bg-amber-500/5">
                    <CardContent className="p-4 space-y-2.5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">🔒</span>
                        <span className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Intern — Nicht an AN übermittelt</span>
                      </div>
                      {((selectedTakt as any).procurementPriority || (selectedTakt as any).riskClassification) && (
                        <div className="flex gap-3">
                          {(selectedTakt as any).procurementPriority && (
                            <div>
                              <div className="text-[10px] text-muted-foreground mb-0.5">Vergabepriorität</div>
                              <div className="text-xs font-medium">{
                                { HIGH: 'Hoch', MEDIUM: 'Mittel', LOW: 'Niedrig' }[(selectedTakt as any).procurementPriority as string]
                              }</div>
                            </div>
                          )}
                          {(selectedTakt as any).riskClassification && (
                            <div>
                              <div className="text-[10px] text-muted-foreground mb-0.5">Risikoklasse</div>
                              <div className="text-xs font-medium">{(selectedTakt as any).riskClassification}</div>
                            </div>
                          )}
                        </div>
                      )}
                      {(selectedTakt as any).costEstimate && (
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-0.5">Kostenschätzung</div>
                          <div className="text-xs font-medium">{(selectedTakt as any).costEstimate}</div>
                        </div>
                      )}
                      {(selectedTakt as any).internalNote && (
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-0.5">Interne Notiz</div>
                          <div className="text-xs text-foreground/80">{(selectedTakt as any).internalNote}</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

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
                        <div className="text-sm font-medium mb-0.5">Anfrage</div>
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
                        {activeTaktRequest.status === 'ALTERNATIVES_PROPOSED' && selectedProposalDetail?.response?.alternatives?.map(alternative => (
                          <div key={alternative.id} className="space-y-1.5 rounded-lg border border-orange-500/25 bg-orange-500/5 p-3">
                            <div className="text-xs font-semibold text-orange-700 dark:text-orange-300">
                              Alternative #{alternative.rank}: {format(new Date(alternative.proposedStart), 'dd.MM.yyyy')}–{format(new Date(alternative.proposedEnd), 'dd.MM.yyyy')}
                            </div>
                            <AlternativeImpactInfo
                              impacts={alternativeImpacts.get(`${selectedProposalDetail.id}:${alternative.id}`) ?? []}
                              taktNameById={taktNameById}
                            />
                          </div>
                        ))}
                        {activeTaktRequest.status === 'REJECTED' && (
                          <div className="flex items-center justify-center p-3 rounded bg-red-500/10 text-red-500 text-sm font-medium">
                            <XCircle className="w-4 h-4 mr-2" /> Abgelehnt
                          </div>
                        )}
                        {['ACCEPTED', 'ALTERNATIVES_PROPOSED', 'REJECTED'].includes(activeTaktRequest.status) && (
                          <Link href={`/leistungsanfragen/${activeTaktRequest.id}`}>
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
                          {closeRequest.isPending ? 'Ziehe zurück…' : 'Anfrage zurückziehen'}
                        </Button>
                      )}
                    </div>
                  ) : (
                    /* No active request — offer inline form */
                    <div>
                      {assignablePartners.length === 0 ? (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/30 border border-border/50 text-sm text-muted-foreground">
                          <Users className="w-4 h-4 mt-0.5 shrink-0" />
                          <span>
                            Noch kein aktiver Projektpartner vorhanden.{' '}
                            <button
                              type="button"
                              className="font-medium text-primary hover:underline"
                              onClick={() => setIsInvitationPackageOpen(true)}
                            >
                              Zum Projekt einladen
                            </button>
                          </span>
                        </div>
                      ) : (
                        <>
                          {canManageTaktRequests && (
                            <button
                              type="button"
                              onClick={() => setIsVergabeOpen(v => !v)}
                              className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 transition-colors text-sm font-medium text-primary"
                            >
                              <span className="flex items-center gap-2">
                                <Send className="w-3.5 h-3.5" />
                                Leistung vergeben
                              </span>
                              {isVergabeOpen
                                ? <ChevronUp className="w-4 h-4" />
                                : <ChevronDown className="w-4 h-4" />
                              }
                            </button>
                          )}

                          {canManageTaktRequests && isVergabeOpen && (
                            <form onSubmit={handleDelegateTakt} className="mt-3 space-y-3 p-3 rounded-lg border border-border/60 bg-muted/10">
                              <div className="space-y-1.5">
                                <Label className="text-xs">Nachunternehmer</Label>
                                <div className="rounded-md border border-input bg-background divide-y">
                                   {assignablePartners.map(a => {
                                     const checked = vergabeAnOrgIds.includes(a.anOrgId);
                                    return (
                                       <label key={a.anOrgId} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50">
                                        <input
                                          type="checkbox"
                                          checked={checked}
                                          onChange={() => {
                                            setVergabeAnOrgIds(current => checked
                                              ? current.filter(id => id !== a.anOrgId)
                                              : [...current, a.anOrgId],
                                            );
                                            setVergabePublicationId('');
                                          }}
                                        />
                                         <span>{a.label}</span>
                                      </label>
                                    );
                                  })}
                                   {assignablePartners.length === 0 && (
                                    <p className="px-3 py-2 text-xs text-muted-foreground">Keine aktiven Nachunternehmer zugeordnet.</p>
                                  )}
                                </div>
                                {vergabeAnOrgIds.length > 0 && (
                                  <p className="text-xs text-muted-foreground">
                                    {vergabeAnOrgIds.length} Nachunternehmer ausgewählt
                                  </p>
                                )}
                              </div>

                              {/* Publication selector — required for the Dataspace policy gate */}
                              <div className="space-y-1.5">
                                <Label className="text-xs">
                                  Veröffentlichte Leistungsinformationen{' '}
                                  <span className="text-destructive">*</span>
                                </Label>
                                {vergabeAnOrgIds.length > 0 && vergabePubs.length === 0 ? (
                                  <p className="text-xs text-muted-foreground rounded border border-border/60 bg-muted/20 p-2">
                                    Keine gültige Veröffentlichung für diese Leistung und alle ausgewählten AN vorhanden.{' '}
                                    <button
                                      type="button"
                                      className="underline text-primary"
                                      onClick={() => setIsDataspaceOpen(true)}
                                    >
                                      Jetzt erstellen
                                    </button>
                                  </p>
                                ) : (
                                  <Select
                                    value={vergabePublicationId}
                                    onValueChange={setVergabePublicationId}
                                    disabled={vergabeAnOrgIds.length === 0}
                                  >
                                    <SelectTrigger>
                                      <SelectValue placeholder={vergabeAnOrgIds.length > 0 ? 'Veröffentlichung auswählen…' : 'Erst AN auswählen'} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {vergabePubs.map(p => (
                                        <SelectItem key={p.id} value={p.id}>
                                          {p.title} (v{p.version})
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                )}
                              </div>

                              <Textarea name="message" placeholder="Hinweis (optional)" className="resize-none h-16" />

                              <div className="space-y-1.5">
                                <Label className="text-xs">
                                  Antwortfrist{' '}
                                  <span className="text-muted-foreground font-normal">(optional)</span>
                                </Label>
                                <DatePicker
                                  includeTime
                                  value={vergabeResponseRequiredBy}
                                  min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)}
                                  onChange={(val) => {
                                    setVergabeResponseRequiredBy(val);
                                    if (val) {
                                      const deadline = new Date(val);
                                      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);
                                      setVergabeResponseRequiredByError(
                                        deadline < oneHourFromNow
                                          ? 'Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen.'
                                          : '',
                                      );
                                    } else {
                                      setVergabeResponseRequiredByError('');
                                    }
                                  }}
                                  className="h-9"
                                />
                                {vergabeResponseRequiredByError && (
                                  <p className="text-xs text-destructive flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3 shrink-0" />
                                    {vergabeResponseRequiredByError}
                                  </p>
                                )}
                              </div>

                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="flex-1"
                                  onClick={() => {
                                    setIsVergabeOpen(false);
                                    setVergabeAnOrgIds([]);
                                    setVergabePublicationId('');
                                    setVergabeResponseRequiredBy('');
                                    setVergabeResponseRequiredByError('');
                                  }}
                                >
                                  Abbrechen
                                </Button>
                                <Button
                                  type="submit"
                                  size="sm"
                                  className="flex-1"
                                  disabled={isDelegating || !vergabePublicationId}
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
              Leistung bearbeiten
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Bezeichnung</Label>
                      <Input name="taktBezeichnung" required value={editTaktBezeichnung} onChange={e => setEditTaktBezeichnung(e.target.value)} placeholder="z.B. T1, Rohbau-A" />
                    </div>
                    <div className="space-y-2">
                      <Label>Zone <span className="text-muted-foreground font-normal">(optional)</span></Label>
                      <Input name="zone" value={editZone} onChange={e => setEditZone(e.target.value)} placeholder="z.B. OG 1, Abschnitt A" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Kurzbezeichnung</Label>
                    <Input name="kurzbezeichnung" required defaultValue={editTargetId ? ((takte ?? []).find(t => t.id === editTargetId)?.kurzbezeichnung ?? '') : ''} placeholder="z.B. R1" />
                  </div>
                  <div className="space-y-2">
                    <Label>Gewerk</Label>
                    <Input name="gewerk" required value={editGewerk} onChange={e => setEditGewerk(e.target.value)} placeholder="z.B. Trockenbau, Elektro" />
                  </div>
                  <div className="space-y-2">
                    <Label>Beschreibung</Label>
                    <Input name="description" value={editDescription} onChange={e => setEditDescription(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div className="space-y-2">
                      <Label>Plan-Start</Label>
                      <DatePicker
                        name="plannedStart"
                        required
                        value={editPlannedStart}
                        onChange={value => {
                          setEditPlannedStart(value);
                          if (editDurationDays && projectCalendar) {
                            setEditPlannedEnd(clientComputePlannedEnd(value, Number(editDurationDays), projectCalendar));
                          }
                        }}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        Dauer (Arbeitstage)
                        <span className="text-[10px] text-muted-foreground font-normal">0,5-Schritte</span>
                      </Label>
                      <Input
                        type="number"
                        min={0.5}
                        step={0.5}
                        placeholder={String((editTakt as { durationDays?: string | number | null }).durationDays ?? 'z.B. 5')}
                        value={editDurationDays}
                        onChange={e => {
                          setEditDurationDays(e.target.value);
                          const startVal = editPlannedStart || editTakt.plannedStart;
                          if (e.target.value && startVal && projectCalendar) {
                            setEditPlannedEnd(clientComputePlannedEnd(startVal, Number(e.target.value), projectCalendar));
                          } else {
                            setEditPlannedEnd('');
                          }
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      Plan-Ende
                      {editDurationDays && editPlannedEnd && (
                        <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-normal">
                          berechnet aus Dauer
                        </span>
                      )}
                    </Label>
                    <DatePicker
                      name="plannedEnd"
                      value={editPlannedEnd || editTakt.plannedEnd}
                      onChange={value => {
                        setEditPlannedEnd(value);
                        setEditDurationDays('');
                      }}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border/50">
                    <div className="space-y-2">
                      <Label className="text-muted-foreground flex items-center gap-1">Frühester Start <span className="text-[10px]">(Puffer)</span></Label>
                      <DatePicker name="earliestStart" value={editEarliestStart} onChange={setEditEarliestStart} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-muted-foreground flex items-center gap-1">Spätestes Ende <span className="text-[10px]">(Puffer)</span></Label>
                      <DatePicker name="latestEnd" value={editLatestEnd} onChange={setEditLatestEnd} />
                    </div>
                  </div>

                  {/* ── Interne Informationen ──────────────────────────── */}
                  <div className="pt-3 border-t border-border/50">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-sm">🔒</span>
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Interne Informationen</span>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Nicht an AN übermittelt</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Interne Notiz</Label>
                        <Textarea name="internalNote" value={editInternalNote} onChange={e => setEditInternalNote(e.target.value)} placeholder="Interne Hinweise für das GU-Team…" className="resize-none h-16 text-sm" />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Kostenschätzung</Label>
                        <Input name="costEstimate" value={editCostEstimate} onChange={e => setEditCostEstimate(e.target.value)} placeholder="z.B. 45.000 €" className="text-sm" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Vergabepriorität</Label>
                          <Select value={editProcPriority} onValueChange={setEditProcPriority}>
                            <SelectTrigger className="text-sm h-9">
                              <SelectValue placeholder="Keine" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="HIGH">Hoch</SelectItem>
                              <SelectItem value="MEDIUM">Mittel</SelectItem>
                              <SelectItem value="LOW">Niedrig</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-muted-foreground">Risikoklasse</Label>
                          <Select value={editRiskClass} onValueChange={setEditRiskClass}>
                            <SelectTrigger className="text-sm h-9">
                              <SelectValue placeholder="Keine" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="A">A — Hoch</SelectItem>
                              <SelectItem value="B">B — Mittel</SelectItem>
                              <SelectItem value="C">C — Niedrig</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Kurzbezeichnung</Label>
                    <Input name="kurzbezeichnung" required placeholder="z.B. R1" />
                  </div>
                </form>

                {deps && deps.some(d => d.predecessorId === editTakt.id || d.successorId === editTakt.id) && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Diese Leistung ist in Anordnungsbeziehungen eingebunden. Beim Speichern werden abhängige Leistungen automatisch verschoben.</span>
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
                    {deleteTakt.isPending ? 'Löscht…' : 'Leistung löschen'}
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
                        <SelectValue placeholder="Vorgänger-Leistung…" />
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
                  <p className="text-sm text-muted-foreground italic">Keine weiteren Leistungen als Vorgänger verfügbar.</p>
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
        <DialogContent className="sm:max-w-3xl w-full">
          <DialogHeader>
            <DialogTitle>Neue Leistung anlegen</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateTakt} className="py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0">

              {/* ── Linke Spalte: Stammdaten ─────────────────────── */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Bezeichnung</Label>
                    <Input name="taktBezeichnung" required placeholder="z.B. T1, Rohbau-A" />
                  </div>
                  <div className="space-y-2">
                    <Label>Kurzbezeichnung</Label>
                    <Input name="kurzbezeichnung" required placeholder="z.B. R1" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Zone <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input name="zone" placeholder="z.B. OG 1, Abschnitt A" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Gewerk</Label>
                  <Input name="gewerk" required placeholder="z.B. Trockenbau, Elektro" />
                </div>
                <div className="space-y-2">
                  <Label>Beschreibung</Label>
                  <Input name="description" placeholder="Optional" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Plan-Start</Label>
                    <DatePicker
                      name="plannedStart"
                      required
                      value={createPlannedStart}
                      onChange={value => {
                        setCreatePlannedStart(value);
                        if (createDurationDays && projectCalendar) {
                          setCreatePlannedEnd(clientComputePlannedEnd(value, Number(createDurationDays), projectCalendar));
                        }
                      }}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      Dauer (Arbeitstage)
                      <span className="text-[10px] text-muted-foreground font-normal">0,5-Schritte</span>
                    </Label>
                    <Input
                      type="number"
                      min={0.5}
                      step={0.5}
                      placeholder="z.B. 5"
                      value={createDurationDays}
                      onChange={e => {
                        setCreateDurationDays(e.target.value);
                        if (e.target.value && createPlannedStart && projectCalendar) {
                          setCreatePlannedEnd(clientComputePlannedEnd(createPlannedStart, Number(e.target.value), projectCalendar));
                        } else {
                          setCreatePlannedEnd('');
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    Plan-Ende
                    {createDurationDays && createPlannedEnd && (
                      <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded font-normal">
                        berechnet aus Dauer
                      </span>
                    )}
                  </Label>
                  <DatePicker
                    name="plannedEnd"
                    value={createPlannedEnd}
                    onChange={value => {
                      setCreatePlannedEnd(value);
                      setCreateDurationDays('');
                    }}
                    required={!createDurationDays}
                    placeholder={createDurationDays ? 'Wird berechnet…' : ''}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border/50">
                  <div className="space-y-2 pt-3">
                    <Label className="text-muted-foreground flex items-center gap-1">
                      Frühester Start <span className="text-[10px]">(Puffer)</span>
                    </Label>
                    <DatePicker name="earliestStart" onChange={() => undefined} />
                  </div>
                  <div className="space-y-2 pt-3">
                    <Label className="text-muted-foreground flex items-center gap-1">
                      Spätestes Ende <span className="text-[10px]">(Puffer)</span>
                    </Label>
                    <DatePicker name="latestEnd" onChange={() => undefined} />
                  </div>
                </div>
              </div>

              {/* ── Rechte Spalte: Interne Informationen ─────────── */}
              <div className="border-l border-border/50 pl-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="text-sm">🔒</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Interne Informationen</span>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Nicht an AN übermittelt</span>
                </div>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Interne Notiz</Label>
                    <Textarea name="internalNote" placeholder="Interne Hinweise für das GU-Team…" className="resize-none h-24 text-sm" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Kostenschätzung</Label>
                    <Input name="costEstimate" placeholder="z.B. 45.000 €" className="text-sm" />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Vergabepriorität</Label>
                    <Select value={createProcPriority} onValueChange={setCreateProcPriority}>
                      <SelectTrigger className="text-sm h-9">
                        <SelectValue placeholder="Keine" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="HIGH">Hoch</SelectItem>
                        <SelectItem value="MEDIUM">Mittel</SelectItem>
                        <SelectItem value="LOW">Niedrig</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Risikoklasse</Label>
                    <Select value={createRiskClass} onValueChange={setCreateRiskClass}>
                      <SelectTrigger className="text-sm h-9">
                        <SelectValue placeholder="Keine" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="A">A — Hoch</SelectItem>
                        <SelectItem value="B">B — Mittel</SelectItem>
                        <SelectItem value="C">C — Niedrig</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Abhängigkeiten (optional) ──────────────────────────── */}
            <div className="mt-6 pt-5 border-t border-border/50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5" />
                  Abhängigkeiten
                  <span className="text-[10px] font-normal text-muted-foreground/60">(optional)</span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    const id = createDepCounter + 1;
                    setCreateDepCounter(id);
                    setCreateDeps(prev => [...prev, { _id: id, predecessorId: '', type: 'EA', lagDays: 0 }]);
                  }}
                >
                  <Plus className="w-3 h-3 mr-1" />
                  Vorgänger hinzufügen
                </Button>
              </div>

              {createDeps.length === 0 && (
                <p className="text-xs text-muted-foreground/60 italic">Keine Abhängigkeiten definiert.</p>
              )}

              <div className="space-y-2">
                {createDeps.map((dep) => (
                  <div key={dep._id} className="flex items-center gap-2 bg-muted/30 rounded-md px-3 py-2">
                    {/* Predecessor picker */}
                    <Select
                      value={dep.predecessorId}
                      onValueChange={(v) =>
                        setCreateDeps(prev => prev.map(d => d._id === dep._id ? { ...d, predecessorId: v } : d))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                        <SelectValue placeholder="Vorgänger wählen…" />
                      </SelectTrigger>
                      <SelectContent>
                        {(takte ?? []).map(t => (
                          <SelectItem key={t.id} value={t.id} className="text-xs">
                            {t.taktBezeichnung} — {t.zone} ({t.gewerk})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Type */}
                    <Select
                      value={dep.type}
                      onValueChange={(v) =>
                        setCreateDeps(prev => prev.map(d => d._id === dep._id ? { ...d, type: v as TaktDependencyType } : d))
                      }
                    >
                      <SelectTrigger className="h-8 text-xs w-36 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.entries(DEP_TYPE_LABEL) as [TaktDependencyType, string][]).map(([k, label]) => (
                          <SelectItem key={k} value={k} className="text-xs">{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {/* Lag */}
                    <div className="flex items-center gap-1 shrink-0">
                      <Input
                        type="number"
                        min={0}
                        step={1}
                        value={dep.lagDays}
                        onChange={(e) =>
                          setCreateDeps(prev => prev.map(d => d._id === dep._id ? { ...d, lagDays: Number(e.target.value) } : d))
                        }
                        className="h-8 text-xs w-16 text-center"
                      />
                      <span className="text-[10px] text-muted-foreground">d</span>
                    </div>

                    {/* Remove */}
                    <button
                      type="button"
                      onClick={() => setCreateDeps(prev => prev.filter(d => d._id !== dep._id))}
                      className="text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <DialogFooter className="mt-6 pt-4 border-t border-border/50">
              <Button type="button" variant="outline" onClick={() => { setIsCreateOpen(false); setCreateDeps([]); }}>Abbrechen</Button>
              <Button type="submit" disabled={createTakt.isPending || createDepSkip.isPending}>
                {createTakt.isPending || createDepSkip.isPending ? 'Wird angelegt…' : 'Leistung anlegen'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Participant Directory ─────────────────────────────────────────────── */}
      <Dialog open={isParticipantDirectoryOpen} onOpenChange={setIsParticipantDirectoryOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              Projektpartner — {project?.projectName}
            </DialogTitle>
          </DialogHeader>

          {/* Membership lifecycle */}
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Projektmitglieder ({memberships?.length ?? 0})
            </p>
            {!memberships?.length ? (
              <p className="text-sm text-muted-foreground italic py-2">Noch keine Teilnehmer eingeladen.</p>
            ) : (
              <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
                {memberships.map(membership => {
                  const org = allAnOrgs?.find(candidate => candidate.id === membership.anOrgId);
                  const status = ({
                    INVITED: { label: 'Einladung ausstehend', className: 'text-amber-600 bg-amber-500/10 border-amber-500/20' },
                    ACTIVE: { label: 'Aktiv', className: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' },
                    REVOKED: { label: 'Widerrufen', className: 'text-red-600 bg-red-500/10 border-red-500/20' },
                    REJECTED: { label: 'Abgelehnt', className: 'text-muted-foreground bg-muted' },
                  } as Record<string, { label: string; className: string }>)[membership.status] ?? { label: membership.status, className: 'text-muted-foreground bg-muted' };
                  const deliveries = [
                    { label: 'Einladung', delivery: membership.invitationDelivery },
                    { label: 'Antwort', delivery: membership.responseDelivery },
                  ].filter((item): item is { label: string; delivery: ProjectInvitationDelivery } =>
                    item.delivery != null && ['PENDING', 'FAILED'].includes(item.delivery.status),
                  );
                  return (
                  <div key={membership.id} className="px-3 py-2 rounded-lg border border-border bg-card">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded bg-primary/15 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                          {(org?.name ?? membership.anOrgId).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{org?.name ?? membership.anOrgId}</div>
                          <span className={`inline-flex mt-0.5 text-[10px] px-1.5 py-0.5 rounded border ${status.className}`}>
                            {status.label}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        {(['INVITED', 'ACTIVE'].includes(membership.status)) && (
                          <Button size="sm" variant="ghost" onClick={() => handleRevokeMembership(membership)}
                            disabled={revokeMembership.isPending} className="text-xs text-red-600 hover:text-red-700">
                            Widerrufen
                          </Button>
                        )}
                      </div>
                    </div>
                    {deliveries.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-border/60 pt-2">
                        {deliveries.map(({ label, delivery }) => {
                          const failed = delivery.status === 'FAILED';
                          return (
                            <div key={delivery.messageId} className="flex items-center justify-between gap-2 text-xs">
                              <span className={failed ? 'text-red-600' : 'text-amber-600'}>
                                {label}: {failed ? 'Zustellung fehlgeschlagen' : 'Zustellung ausstehend'}
                                <span className="ml-1 text-muted-foreground">
                                  (Versuch {delivery.attemptCount}/5)
                                </span>
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => handleRetryInvitationDelivery(delivery)}
                                disabled={retryInvitationDelivery.isPending}
                              >
                                <RefreshCw className="mr-1 h-3 w-3" />
                                Erneut senden
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-4 text-sm text-muted-foreground">
            Neue Teilnehmer werden über <strong>Einladung &amp; Freigabe</strong> gemeinsam mit einer Policy und einem Informationspaket eingeladen.
          </div>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Gewerk (optional)</Label>
                    <Input value={editTrade} onChange={(e) => setEditTrade(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Arbeitspaket (optional)</Label>
                    <Input value={editWorkPackageReference} onChange={(e) => setEditWorkPackageReference(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Gültig ab (optional)</Label>
                    <DatePicker value={editValidFrom} onChange={setEditValidFrom} />
                  </div>
                  <div className="space-y-2">
                    <Label>Gültig bis (optional)</Label>
                    <DatePicker value={editValidTo} onChange={setEditValidTo} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editAssignmentStatus} onValueChange={(v) => setEditAssignmentStatus(v as 'PLANNED' | 'ACTIVE' | 'INACTIVE')}>
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
      {/* ── Gantt dependency details dialog ─────────────────────────────────── */}
      <Dialog
        open={ganttLinkDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setGanttLinkDialogOpen(false);
            setGanttLinkSuccessorId(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" />
              Abhängigkeit im Gantt anlegen
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-24">Vorgänger</span>
                <span className="font-medium truncate">
                  {ganttLinkPredecessorId ? taktNameById.get(ganttLinkPredecessorId) : '–'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-24">Nachfolger</span>
                <span className="font-medium truncate">
                  {ganttLinkSuccessorId ? taktNameById.get(ganttLinkSuccessorId) : '–'}
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Beziehungstyp</Label>
              <Select value={ganttLinkType} onValueChange={(value) => setGanttLinkType(value as TaktDependencyType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(DEP_TYPE_LABEL) as TaktDependencyType[]).map((type) => (
                    <SelectItem key={type} value={type}>
                      {type} — {DEP_TYPE_LABEL[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gantt-link-lag">Zeitversatz in Tagen</Label>
              <Input
                id="gantt-link-lag"
                type="number"
                min={0}
                step={1}
                value={ganttLinkLag}
                onChange={(event) => setGanttLinkLag(Math.max(0, Number(event.target.value) || 0))}
              />
              <p className="text-xs text-muted-foreground">Optionaler Abstand zwischen den beiden Leistungen.</p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={resetGanttLinkMode}>Abbrechen</Button>
            <Button type="button" onClick={confirmGanttLink}>
              <Link2 className="w-4 h-4 mr-2" />
              Verbindung vorbereiten
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* ── Dep reschedule confirmation dialog ───────────────────────────────── */}
      <AlertDialog open={depRescheduleOpen} onOpenChange={setDepRescheduleOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Plantermine automatisch anpassen?</AlertDialogTitle>
            <AlertDialogDescription>
              Soll das System die Plan-Start- und -Endtermine der Nachfolge-Leistungen aufgrund dieser neuen Abhängigkeit automatisch neu berechnen?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDepRescheduleOpen(false);
                executeDepCreate(true); // skip = no reschedule
              }}
            >
              Nein, nicht anpassen
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDepRescheduleOpen(false);
                executeDepCreate(false); // reschedule
              }}
            >
              Ja, Termine anpassen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Edit Project Dialog ───────────────────────────────────────────────── */}
      <Dialog open={isEditProjectOpen} onOpenChange={setIsEditProjectOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-primary" />
              Projektdaten bearbeiten
            </DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const name = epName.trim();
              if (!name) return;
              updateProject.mutate(
                {
                  projectId,
                  data: {
                    name,
                    description: epDescription.trim() || undefined,
                    location: epLocation.trim() || undefined,
                    status: epStatus,
                    startDate: epStartDate || undefined,
                    endDate: epEndDate || undefined,
                  },
                },
                {
                  onSuccess: () => {
                    toast({ title: 'Projekt aktualisiert' });
                    queryClient.invalidateQueries({ queryKey: ['getAgProjectOverview', projectId] });
                    queryClient.invalidateQueries({ queryKey: getGetProjectQueryKey(projectId) });
                    queryClient.invalidateQueries({ queryKey: getGetAgProjectsOverviewQueryKey() });
                    setIsEditProjectOpen(false);
                  },
                  onError: (err) => toast({ title: 'Fehler', description: err.message, variant: 'destructive' }),
                },
              );
            }}
            className="space-y-4 mt-2"
          >
            <div className="space-y-2">
              <Label htmlFor="ep-name">Projektname *</Label>
              <Input id="ep-name" name="name" required value={epName} onChange={(e) => setEpName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ep-description">Beschreibung</Label>
              <Textarea id="ep-description" name="description" rows={2} value={epDescription} onChange={(e) => setEpDescription(e.target.value)} placeholder="Kurze Projektbeschreibung…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ep-location">Standort / Adresse</Label>
              <Input id="ep-location" name="location" value={epLocation} onChange={(e) => setEpLocation(e.target.value)} placeholder="z. B. Hauptstraße 1, 44801 Bochum" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ep-start">Startdatum</Label>
                <DatePicker id="ep-start" name="startDate" value={epStartDate} onChange={setEpStartDate} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ep-end">Enddatum</Label>
                <DatePicker id="ep-end" name="endDate" value={epEndDate} onChange={setEpEndDate} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="ep-status">Status</Label>
              <Select value={epStatus} onValueChange={(v) => setEpStatus(v as 'ACTIVE' | 'COMPLETED' | 'ARCHIVED')}>
                <SelectTrigger id="ep-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Aktiv</SelectItem>
                  <SelectItem value="COMPLETED">Abgeschlossen</SelectItem>
                  <SelectItem value="ARCHIVED">Archiviert</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsEditProjectOpen(false)}>
                Abbrechen
              </Button>
              <Button type="submit" disabled={updateProject.isPending}>
                {updateProject.isPending ? 'Wird gespeichert…' : 'Speichern'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Dataspace Publication Wizard ──────────────────────────────────────── */}
      {project && (
        <DataPublicationWizard
          open={isDataspaceOpen}
          onOpenChange={setIsDataspaceOpen}
          projectId={projectId}
          projectName={project.projectName ?? ''}
          contractors={(assignments ?? []).map(a => ({
            id: a.id,
            name: a.anName ?? a.anOrgId,
            orgId: a.anOrgId,
            assignmentStatus: a.assignmentStatus,
            trade: a.trade,
          }))}
        />
      )}

      {project && (
        <ProjectInvitationWizard
          open={isInvitationPackageOpen}
          onOpenChange={setIsInvitationPackageOpen}
          projectId={projectId}
          projectName={project.projectName ?? ''}
          participants={allAnOrgs ?? []}
          onInvitationSent={() => {
            void queryClient.invalidateQueries({ queryKey: getListProjectMembershipsQueryKey(projectId) });
            void queryClient.invalidateQueries({ queryKey: ['dataspace-participants', projectId] });
          }}
        />
      )}

      {/* ── Bestätigungsdialog: Leistung löschen ─────────────────────────── */}
      <AlertDialog open={confirmDeleteTakt} onOpenChange={setConfirmDeleteTakt}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leistung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Leistung und alle zugehörigen Anordnungsbeziehungen werden
              unwiderruflich gelöscht. Diese Aktion kann nicht rückgängig gemacht werden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDeleteTakt}
              disabled={deleteTakt.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteTakt.isPending ? 'Löscht…' : 'Endgültig löschen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bestätigungsdialog: Projektmitgliedschaft widerrufen ──────────── */}
      <AlertDialog open={!!confirmRevokeMembership} onOpenChange={(o) => !o && setConfirmRevokeMembership(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Projektmitgliedschaft widerrufen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Einladung oder aktive Projektmitgliedschaft wird widerrufen.
              Bereits gestellte Anfragen bleiben im System erhalten.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={doRevokeMembership}
              disabled={revokeMembership.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {revokeMembership.isPending ? 'Widerruft…' : 'Widerrufen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bestätigungsdialog: Anfrage zurückziehen ──────────────────────── */}
      <AlertDialog open={confirmCloseRequest} onOpenChange={setConfirmCloseRequest}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anfrage zurückziehen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die laufende Anfrage wird zurückgezogen. Der Nachunternehmer kann darauf
              nicht mehr antworten. Danach können Sie die Leistung erneut anfragen,
              auch bei einem anderen Nachunternehmer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={doCloseRequest}
              disabled={closeRequest.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {closeRequest.isPending ? 'Ziehe zurück…' : 'Anfrage zurückziehen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Bestätigungsdialog: Anordnungsbeziehung löschen ─────────────── */}
      <AlertDialog open={!!confirmDeleteDep} onOpenChange={(o) => !o && setConfirmDeleteDep(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Anordnungsbeziehung löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Anordnungsbeziehung zwischen den Leistungen wird gelöscht. Die
              Plantermine der Leistungen bleiben unverändert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              onClick={doDeleteDependency}
              disabled={deleteDep.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteDep.isPending ? 'Löscht…' : 'Beziehung löschen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
