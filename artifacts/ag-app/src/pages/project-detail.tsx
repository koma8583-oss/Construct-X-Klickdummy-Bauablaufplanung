import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams, Link } from 'wouter';
import { format } from 'date-fns';
import { 
  useGetProject, 
  useListTakte,
  useCreateTakt,
  useListProjectContractors,
  useListOrganizations,
  useCreateDelegation,
  useListDelegations,
  getListTakteQueryKey,
  getListDelegationsQueryKey,
  getGetProjectQueryKey,
  getListProjectContractorsQueryKey
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Gantt, Task, ViewMode } from 'gantt-task-react';
import 'gantt-task-react/dist/index.css';
import { 
  ArrowLeft, Plus, Users, Calendar, MapPin, 
  AlignLeft, AlertCircle, Info, Send, CheckCircle, Clock
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
import { useToast } from '@/hooks/use-toast';

// Helper to map delegation status to color
const getTaktColor = (status?: string | null) => {
  switch (status) {
    case 'CONFIRMED': return '#10b981'; // emerald-500
    case 'PENDING': return '#f59e0b'; // amber-500
    case 'ALTERNATIVE_PROPOSED': return '#3b82f6'; // blue-500
    case 'REJECTED': return '#ef4444'; // red-500
    default: return '#64748b'; // slate-500 (UNDELEGATED)
  }
};

export default function ProjectDetail() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);
  const [selectedTaktId, setSelectedTaktId] = useState<string | null>(null);
  const [isCreateTaktOpen, setIsCreateTaktOpen] = useState(false);

  // Queries
  const { data: project, isLoading: projectLoading } = useGetProject(projectId, { 
    query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } 
  });
  
  const { data: takte, isLoading: takteLoading } = useListTakte(projectId, {
    query: { enabled: !!projectId, queryKey: getListTakteQueryKey(projectId) }
  });

  const { data: contractors } = useListProjectContractors(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectContractorsQueryKey(projectId) }
  });

  const { data: delegations } = useListDelegations({ projectId }, {
    query: { enabled: !!projectId, queryKey: getListDelegationsQueryKey({ projectId }) }
  });

  // Mutations
  const createTakt = useCreateTakt();
  const createDelegation = useCreateDelegation();

  const ganttTasks: Task[] = useMemo(() => {
    if (!takte || takte.length === 0) return [];
    
    return takte.map(takt => {
      const color = getTaktColor(takt.delegationStatus);
      return {
        id: takt.id,
        name: `Takt ${takt.taktNumber} - ${takt.gewerk}`,
        start: new Date(takt.plannedStart),
        end: new Date(takt.plannedEnd),
        type: 'task' as const,
        progress: 100,
        isDisabled: false,
        styles: {
          progressColor: color,
          progressSelectedColor: color,
          backgroundColor: color + '80', // lighter background for the box
          backgroundSelectedColor: color + 'aa',
        }
      };
    }).sort((a, b) => a.start.getTime() - b.start.getTime());
  }, [takte]);

  const selectedTakt = useMemo(() => 
    takte?.find(t => t.id === selectedTaktId), 
  [takte, selectedTaktId]);

  const taktDelegation = useMemo(() => 
    delegations?.find(d => d.taktId === selectedTaktId),
  [delegations, selectedTaktId]);

  const handleCreateTakt = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    createTakt.mutate({
      projectId,
      data: {
        taktNumber: Number(formData.get('taktNumber')),
        zone: formData.get('zone') as string,
        gewerk: formData.get('gewerk') as string,
        description: formData.get('description') as string,
        plannedStart: formData.get('plannedStart') as string,
        plannedEnd: formData.get('plannedEnd') as string,
        earliestStart: formData.get('earliestStart') as string || undefined,
        latestEnd: formData.get('latestEnd') as string || undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: t('common.success') });
        queryClient.invalidateQueries({ queryKey: getListTakteQueryKey(projectId) });
        setIsCreateTaktOpen(false);
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
      }
    });
  };

  const handleDelegateTakt = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTakt) return;
    
    const formData = new FormData(e.currentTarget);
    
    createDelegation.mutate({
      data: {
        taktId: selectedTakt.id,
        anOrgId: formData.get('anOrgId') as string,
        requestedStart: formData.get('requestedStart') as string,
        requestedEnd: formData.get('requestedEnd') as string,
        earliestStart: selectedTakt.earliestStart || undefined,
        latestEnd: selectedTakt.latestEnd || undefined,
        message: formData.get('message') as string,
      }
    }, {
      onSuccess: () => {
        toast({ title: 'Takt delegated successfully' });
        queryClient.invalidateQueries({ queryKey: getListTakteQueryKey(projectId) });
        queryClient.invalidateQueries({ queryKey: getListDelegationsQueryKey({ projectId }) });
        setSelectedTaktId(null);
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
      }
    });
  };

  if (projectLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-1/3" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (!project) {
    return <div>Project not found</div>;
  }

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
              <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'}>
                {project.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              {project.location && (
                <span className="flex items-center"><MapPin className="w-3.5 h-3.5 mr-1" /> {project.location}</span>
              )}
              <span className="flex items-center"><Calendar className="w-3.5 h-3.5 mr-1" /> 
                {project.startDate ? format(new Date(project.startDate), 'MMM d, yyyy') : 'TBD'} - 
                {project.endDate ? format(new Date(project.endDate), 'MMM d, yyyy') : 'TBD'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Link href={`/projects/${projectId}/proposals`}>
            <Button variant="outline" className="relative">
              {project.pendingResponseCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
                </span>
              )}
              <AlignLeft className="w-4 h-4 mr-2" />
              {t('projects.proposals')}
            </Button>
          </Link>
          <Button onClick={() => setIsCreateTaktOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            New Takt
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 bg-card border border-border rounded-xl overflow-hidden flex flex-col">
        <div className="border-b border-border p-4 bg-background flex items-center justify-between">
          <h2 className="font-semibold text-lg flex items-center">
            <AlignLeft className="w-5 h-5 mr-2 text-primary" />
            {t('projects.gantt')}
          </h2>
          <div className="flex items-center gap-2">
            <Select value={viewMode} onValueChange={(val) => setViewMode(val as ViewMode)}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue placeholder="View Mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ViewMode.Day}>Day</SelectItem>
                <SelectItem value={ViewMode.Week}>Week</SelectItem>
                <SelectItem value={ViewMode.Month}>Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 custom-gantt-container bg-background">
          {takteLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Loading schedule...
            </div>
          ) : ganttTasks.length > 0 ? (
            <div className="rounded-lg border border-border overflow-hidden bg-card text-card-foreground">
              {/* Force gantt styles to adapt to dark mode using CSS variables injected via style */}
              <style dangerouslySetInnerHTML={{__html: `
                .gantt { font-family: var(--font-sans) !important; }
                .gantt ._3zlnZ { fill: hsl(var(--card)) !important; }
                .gantt ._3wXGj { fill: hsl(var(--foreground)) !important; }
                .gantt ._3r-f2 { stroke: hsl(var(--border)) !important; }
                .gantt ._3vWJ5 { fill: hsl(var(--muted)) !important; }
              `}} />
              <Gantt
                tasks={ganttTasks}
                viewMode={viewMode}
                onClick={(task) => setSelectedTaktId(task.id)}
                listCellWidth="200px"
                columnWidth={viewMode === ViewMode.Day ? 60 : viewMode === ViewMode.Week ? 200 : 300}
                rowHeight={48}
                fontSize="12"
                fontFamily="inherit"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Calendar className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="font-medium text-lg">No Takte scheduled yet</h3>
              <p className="text-muted-foreground text-sm max-w-sm mt-1">
                Create tasks to build your project schedule and start delegating work to contractors.
              </p>
              <Button onClick={() => setIsCreateTaktOpen(true)} className="mt-6">
                <Plus className="w-4 h-4 mr-2" />
                Create First Takt
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Delegation Side Panel */}
      <Sheet open={!!selectedTaktId} onOpenChange={(open) => !open && setSelectedTaktId(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto border-l-border">
          {selectedTakt && (
            <>
              <SheetHeader className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="outline" className="font-mono text-xs">
                    TAKT {selectedTakt.taktNumber}
                  </Badge>
                  <Badge 
                    style={{ backgroundColor: getTaktColor(selectedTakt.delegationStatus) + '20', color: getTaktColor(selectedTakt.delegationStatus) }}
                    className="border-transparent"
                  >
                    {t(`takt.status.${selectedTakt.delegationStatus || 'UNDELEGATED'}`)}
                  </Badge>
                </div>
                <SheetTitle className="text-xl">{selectedTakt.gewerk}</SheetTitle>
                <SheetDescription>Zone: {selectedTakt.zone}</SheetDescription>
              </SheetHeader>

              <div className="space-y-6">
                {/* Details Card */}
                <Card className="bg-muted/30 border-border/50">
                  <CardContent className="p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Planned Start</div>
                        <div className="text-sm font-medium">{format(new Date(selectedTakt.plannedStart), 'MMM d, yyyy')}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Planned End</div>
                        <div className="text-sm font-medium">{format(new Date(selectedTakt.plannedEnd), 'MMM d, yyyy')}</div>
                      </div>
                    </div>
                    
                    {(selectedTakt.earliestStart || selectedTakt.latestEnd) && (
                      <div className="pt-3 border-t border-border/50">
                        <div className="flex items-center text-xs text-amber-500 font-medium mb-2">
                          <Info className="w-3.5 h-3.5 mr-1" />
                          Buffer Window Available
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Earliest Start</div>
                            <div className="text-sm">{selectedTakt.earliestStart ? format(new Date(selectedTakt.earliestStart), 'MMM d, yyyy') : '-'}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Latest End</div>
                            <div className="text-sm">{selectedTakt.latestEnd ? format(new Date(selectedTakt.latestEnd), 'MMM d, yyyy') : '-'}</div>
                          </div>
                        </div>
                      </div>
                    )}

                    {selectedTakt.description && (
                      <div className="pt-3 border-t border-border/50">
                        <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Description</div>
                        <div className="text-sm text-foreground/80">{selectedTakt.description}</div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Delegation Section */}
                <div>
                  <h3 className="text-lg font-semibold mb-4 flex items-center">
                    <Send className="w-4 h-4 mr-2 text-primary" />
                    Delegation
                  </h3>

                  {selectedTakt.delegationStatus === 'UNDELEGATED' || !selectedTakt.delegationStatus ? (
                    <form onSubmit={handleDelegateTakt} className="space-y-4">
                      <div className="space-y-2">
                        <Label>Select Contractor</Label>
                        <Select name="anOrgId" required>
                          <SelectTrigger>
                            <SelectValue placeholder="Choose a contractor..." />
                          </SelectTrigger>
                          <SelectContent>
                            {contractors?.map(c => (
                              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Requested Start</Label>
                          <Input 
                            type="date" 
                            name="requestedStart" 
                            defaultValue={selectedTakt.plannedStart.split('T')[0]} 
                            required 
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Requested End</Label>
                          <Input 
                            type="date" 
                            name="requestedEnd" 
                            defaultValue={selectedTakt.plannedEnd.split('T')[0]} 
                            required 
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Message (Optional)</Label>
                        <Textarea 
                          name="message" 
                          placeholder="Add any specific instructions..."
                          className="resize-none h-20"
                        />
                      </div>

                      <Button type="submit" className="w-full mt-2" disabled={createDelegation.isPending}>
                        {createDelegation.isPending ? 'Delegating...' : 'Send Request'}
                      </Button>
                    </form>
                  ) : taktDelegation ? (
                    <div className="space-y-4">
                      <div className="p-4 rounded-lg border border-border bg-card">
                        <div className="text-sm font-medium mb-1">Current Delegation</div>
                        <div className="text-sm text-muted-foreground mb-4">
                          Sent to: <span className="text-foreground">{taktDelegation.anOrganization?.name || 'Contractor'}</span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4 mb-4">
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Requested Start</div>
                            <div className="text-sm">{format(new Date(taktDelegation.requestedStart), 'MMM d, yyyy')}</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Requested End</div>
                            <div className="text-sm">{format(new Date(taktDelegation.requestedEnd), 'MMM d, yyyy')}</div>
                          </div>
                        </div>

                        {taktDelegation.status === 'PENDING' && (
                          <div className="flex items-center justify-center p-3 rounded bg-amber-500/10 text-amber-500 text-sm font-medium">
                            <Clock className="w-4 h-4 mr-2" />
                            Waiting for response
                          </div>
                        )}
                        
                        {taktDelegation.status === 'CONFIRMED' && (
                          <div className="flex items-center justify-center p-3 rounded bg-emerald-500/10 text-emerald-500 text-sm font-medium">
                            <CheckCircle className="w-4 h-4 mr-2" />
                            Confirmed by Contractor
                          </div>
                        )}

                        {taktDelegation.status === 'ALTERNATIVE_PROPOSED' && (
                          <div className="mt-4 pt-4 border-t border-border">
                            <Button variant="outline" className="w-full border-blue-500 text-blue-500 hover:bg-blue-500/10">
                              <Link href={`/projects/${projectId}/proposals`}>Review Proposal</Link>
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Loading delegation details...</div>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Takt Dialog */}
      <Dialog open={isCreateTaktOpen} onOpenChange={setIsCreateTaktOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Create New Takt</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateTakt} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Takt Number</Label>
                <Input name="taktNumber" type="number" required min="1" />
              </div>
              <div className="space-y-2">
                <Label>Zone</Label>
                <Input name="zone" required placeholder="e.g. Floor 1, Section A" />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Gewerk (Trade)</Label>
              <Input name="gewerk" required placeholder="e.g. Drywall, Electrical" />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Input name="description" />
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <Label>Planned Start</Label>
                <Input name="plannedStart" type="date" required />
              </div>
              <div className="space-y-2">
                <Label>Planned End</Label>
                <Input name="plannedEnd" type="date" required />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/50 mt-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-1">Earliest Start <span className="text-[10px]">(Buffer)</span></Label>
                <Input name="earliestStart" type="date" />
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground flex items-center gap-1">Latest End <span className="text-[10px]">(Buffer)</span></Label>
                <Input name="latestEnd" type="date" />
              </div>
            </div>

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => setIsCreateTaktOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createTakt.isPending}>
                Create Takt
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
