import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Calendar, Clock, MapPin, Pencil, Send } from 'lucide-react';
import { format } from 'date-fns';
import { Link, useParams } from 'wouter';
import {
  useGetProject, useListTakte, getGetProjectQueryKey, getListTakteQueryKey,
  useUpdateTakt, useListProjectSubcontractors, getListProjectSubcontractorsQueryKey,
  useListProjectMemberships, getListProjectMembershipsQueryKey,
  useGetProjectDataPublications, useCreateTaktRequestBatchWithSnapshot, useSendTaktRequest,
  useListTaktRequests, useDeleteTakt,
  getListTaktRequestsQueryKey, getGetAgProjectsOverviewQueryKey,
  useGetPolicyTemplateRegistry,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DatePicker } from '@/components/date-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { buildAssignablePartners } from '@/lib/vergabe';

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Entwurf',
  PLANNED: 'Geplant',
  IN_PROGRESS: 'In Bearbeitung',
  COMPLETED: 'Abgeschlossen',
  CANCELLED: 'Abgebrochen',
};

export default function TaktDetail() {
  const { projectId = '', taktId = '' } = useParams<{ projectId: string; taktId: string }>();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: project } = useGetProject(projectId, { query: { enabled: !!projectId, queryKey: getGetProjectQueryKey(projectId) } });
  const { data: takte, isLoading } = useListTakte(projectId, { query: { enabled: !!projectId, queryKey: getListTakteQueryKey(projectId) } });
  const { data: taktRequests } = useListTaktRequests(undefined, {
    query: { enabled: !!projectId, queryKey: getListTaktRequestsQueryKey() },
  });
  const { data: assignments } = useListProjectSubcontractors(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectSubcontractorsQueryKey(projectId) },
  });
  const { data: memberships } = useListProjectMemberships(projectId, {
    query: { enabled: !!projectId, queryKey: getListProjectMembershipsQueryKey(projectId) },
  });
  const { data: publications } = useGetProjectDataPublications(projectId);
  const { data: dataspaceParticipants } = useQuery({
    queryKey: ['takt-detail-dataspace-participants', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      const response = await fetch(
        `/api/dataspace/participants?organizationType=AN&projectId=${encodeURIComponent(projectId)}`,
      );
      if (!response.ok) throw new Error('Nachunternehmer konnten nicht geladen werden.');
      return response.json() as Promise<Array<{
        localOrgId: string;
        participantId: string;
        organizationName: string;
      }>>;
    },
  });
  const { data: policyRegistry } = useGetPolicyTemplateRegistry();
  const updateTakt = useUpdateTakt();
  const createRequestBatch = useCreateTaktRequestBatchWithSnapshot();
  const sendRequest = useSendTaktRequest();
  const deleteTakt = useDeleteTakt();
  const takt = takte?.find((item) => item.id === taktId);
  const activeRequest = taktRequests?.find((request) => request.taktId === taktId && !['CLOSED', 'REJECTED'].includes(request.status));
  const [editOpen, setEditOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [selectedNuIds, setSelectedNuIds] = useState<string[]>([]);
  const [publicationId, setPublicationId] = useState('');
  const [selectedPolicyKey, setSelectedPolicyKey] = useState('');
  const [responseRequiredBy, setResponseRequiredBy] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [editPlannedStart, setEditPlannedStart] = useState('');
  const [editPlannedEnd, setEditPlannedEnd] = useState('');
  const [editDurationDays, setEditDurationDays] = useState('');
  const [editEarliestStart, setEditEarliestStart] = useState('');
  const [editLatestEnd, setEditLatestEnd] = useState('');
  const [editInternalNote, setEditInternalNote] = useState('');
  const [editCostEstimate, setEditCostEstimate] = useState('');
  const [editProcurementPriority, setEditProcurementPriority] = useState('');
  const [editRiskClassification, setEditRiskClassification] = useState('');

  useEffect(() => {
    if (!editOpen || !takt) return;
    setEditPlannedStart(takt.plannedStart);
    setEditPlannedEnd(takt.plannedEnd);
    setEditDurationDays(String((takt as { durationDays?: string | number | null }).durationDays ?? ''));
    setEditEarliestStart(takt.earliestStart ?? '');
    setEditLatestEnd(takt.latestEnd ?? '');
    setEditInternalNote((takt as { internalNote?: string | null }).internalNote ?? '');
    setEditCostEstimate((takt as { costEstimate?: string | null }).costEstimate ?? '');
    setEditProcurementPriority((takt as { procurementPriority?: string | null }).procurementPriority ?? '');
    setEditRiskClassification((takt as { riskClassification?: string | null }).riskClassification ?? '');
  }, [editOpen, takt]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!takt) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-4">
        <Button asChild variant="ghost" className="-ml-3">
          <Link href={`/projects/${projectId}`}><ArrowLeft className="w-4 h-4 mr-2" />Zurück zum Projekt</Link>
        </Button>
        <h1 className="text-2xl font-semibold">Leistung nicht gefunden</h1>
        <p className="text-muted-foreground">Die ausgewählte Leistung ist in diesem Projekt nicht mehr verfügbar.</p>
      </div>
    );
  }

  const projectName = project?.name ?? 'Projekt';
  const participantDirectory = (dataspaceParticipants ?? []).map((participant) => ({
    id: participant.localOrgId,
    name: participant.organizationName,
  }));
  const assignablePartners = buildAssignablePartners(assignments, memberships, participantDirectory)
    .map((partner) => ({ id: partner.anOrgId, name: partner.label }));
  const schedulePolicies = useMemo(
    () => (policyRegistry ?? [])
      .filter((policy) => policy.code === 'SCHEDULE_COORDINATION')
      .sort((a, b) => b.version - a.version),
    [policyRegistry],
  );
  const selectedPolicy = schedulePolicies.find(
    (policy) => `${policy.code}:${policy.version}` === selectedPolicyKey,
  )
    ?? schedulePolicies[0];
  useEffect(() => {
    const policyKey = selectedPolicy ? `${selectedPolicy.code}:${selectedPolicy.version}` : '';
    if (policyKey && selectedPolicyKey !== policyKey) {
      setSelectedPolicyKey(policyKey);
    }
  }, [selectedPolicy, selectedPolicyKey]);
  const durationDays = (takt as { durationDays?: string | number | null }).durationDays;
  const eligiblePublications = (publications ?? []).filter(
    (publication) =>
      publication.dataProductType === 'TAKT_INFORMATION_PACKAGE' &&
      publication.status === 'PUBLISHED' &&
      (publication.selectedTaktIds == null || publication.selectedTaktIds.includes(takt.id)) &&
      selectedNuIds.every((nuId) => (publication.recipients ?? []).some((recipient) => recipient.anOrgId === nuId)) &&
      (!selectedPolicy || publication.policyCode === selectedPolicy.code || publication.policy?.code === selectedPolicy.code),
  );

  const refreshTaktData = () => {
    queryClient.invalidateQueries({ queryKey: getListTakteQueryKey(projectId) });
    queryClient.invalidateQueries({ queryKey: getListTaktRequestsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAgProjectsOverviewQueryKey() });
  };

  const handleEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await updateTakt.mutateAsync({
        projectId,
        taktId: takt.id,
        data: {
          taktBezeichnung: String(data.get('taktBezeichnung') ?? ''),
          kurzbezeichnung: String(data.get('kurzbezeichnung') ?? '').trim(),
          zone: String(data.get('zone') ?? '').trim() || null,
          gewerk: String(data.get('gewerk') ?? ''),
          description: String(data.get('description') ?? '') || undefined,
          plannedStart: String(data.get('plannedStart') ?? ''),
          plannedEnd: editDurationDays ? undefined : String(data.get('plannedEnd') ?? ''),
          durationDays: editDurationDays ? Number(editDurationDays) : undefined,
          earliestStart: String(data.get('earliestStart') ?? '') || undefined,
          latestEnd: String(data.get('latestEnd') ?? '') || undefined,
          internalNote: String(data.get('internalNote') ?? '') || null,
          costEstimate: String(data.get('costEstimate') ?? '') || null,
          procurementPriority: editProcurementPriority || null,
          riskClassification: editRiskClassification || null,
        } as any,
      });
      refreshTaktData();
      setEditOpen(false);
      toast({ title: 'Leistung gespeichert' });
    } catch (error) {
      toast({ title: 'Fehler beim Speichern', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleAssign = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!publicationId || selectedNuIds.length === 0) {
      toast({ title: 'Angaben fehlen', description: 'Wählen Sie mindestens einen Nachunternehmer und eine Veröffentlichung aus.', variant: 'destructive' });
      return;
    }
    setSavingAssignment(true);
    try {
      const created = await createRequestBatch.mutateAsync({
        data: {
          taktId: takt.id,
          nuOrgIds: selectedNuIds,
          message: String(new FormData(event.currentTarget).get('message') ?? '') || undefined,
          dataPublicationId: publicationId,
          ...(responseRequiredBy ? { responseRequiredBy: new Date(responseRequiredBy).toISOString() } : {}),
        },
      });
      await Promise.all(created.requests.map((request) => sendRequest.mutateAsync({ requestId: request.id })));
      refreshTaktData();
      setAssignOpen(false);
      setSelectedNuIds([]);
      setPublicationId('');
      setSelectedPolicyKey('');
      setResponseRequiredBy('');
      toast({ title: selectedNuIds.length === 1 ? 'Anfrage gesendet' : 'Anfragen gesendet' });
    } catch (error) {
      toast({ title: 'Fehler bei der Vergabe', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setSavingAssignment(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Soll diese Leistung wirklich gelöscht werden?')) return;
    try {
      await deleteTakt.mutateAsync({ projectId, taktId });
      toast({ title: 'Leistung gelöscht' });
      window.location.href = `/projects/${projectId}`;
    } catch (error) {
      toast({ title: 'Fehler beim Löschen', description: (error as Error).message, variant: 'destructive' });
    }
  };
  const start = new Date(takt.plannedStart);
  const end = new Date(takt.plannedEnd);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <Button asChild variant="ghost" className="-ml-3 mb-6">
          <Link href={`/projects/${projectId}`}><ArrowLeft className="w-4 h-4 mr-2" />Zurück zum Projekt</Link>
        </Button>
          <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">{projectName} · Leistung</p>
            <h1 className="text-3xl font-semibold tracking-tight">{takt.taktBezeichnung}</h1>
            <p className="text-lg text-muted-foreground mt-1">{takt.gewerk}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-sm px-3 py-1">{STATUS_LABEL[takt.status] ?? takt.status}</Badge>
            <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="w-4 h-4 mr-2" />Bearbeiten</Button>
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="flex items-start gap-3">
              <Calendar className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Planzeitraum</p>
                <p className="font-medium mt-1">{format(start, 'dd.MM.yyyy')} – {format(end, 'dd.MM.yyyy')}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Zone</p>
                <p className="font-medium mt-1">{takt.zone || 'Keine Zone angegeben'}</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-primary mt-0.5" />
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Dauer</p>
                <p className="font-medium mt-1">{durationDays ? `${durationDays} Arbeitstage` : 'Nicht angegeben'}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {takt.description && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Beschreibung</h2>
          <p className="text-base leading-7">{takt.description}</p>
        </section>
      )}

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Vergabe</h2>
              <p className="text-sm text-muted-foreground">Leistung an einen oder mehrere Nachunternehmer anfragen.</p>
            </div>
            <Button onClick={() => setAssignOpen(true)} disabled={assignablePartners.length === 0}>
              <Send className="w-4 h-4 mr-2" />Leistung vergeben
            </Button>
          </div>
          {assignablePartners.length === 0 && (
            <p className="text-sm text-muted-foreground">Keine aktiven Nachunternehmer diesem Projekt zugeordnet.</p>
          )}
        </CardContent>
      </Card>

      {activeRequest && (
        <Card>
          <CardContent className="p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-semibold">Aktuelle Vergabe</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Anfrage {activeRequest.requestNumber} · {STATUS_LABEL[activeRequest.status] ?? activeRequest.status}
              </p>
            </div>
            <Button asChild variant="outline">
              <Link href={`/leistungsanfragen/${activeRequest.id}`}>Anfrage öffnen</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Leistung bearbeiten</DialogTitle></DialogHeader>
          <form id="takt-edit-form" onSubmit={handleEdit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Bezeichnung</Label><Input name="taktBezeichnung" defaultValue={takt.taktBezeichnung} required /></div>
              <div className="space-y-2"><Label>Kurzbezeichnung</Label><Input name="kurzbezeichnung" defaultValue={takt.kurzbezeichnung ?? ''} required /></div>
              <div className="space-y-2"><Label>Zone <span className="text-muted-foreground font-normal">(optional)</span></Label><Input name="zone" defaultValue={takt.zone ?? ''} /></div>
            </div>
            <div className="space-y-2"><Label>Gewerk</Label><Input name="gewerk" defaultValue={takt.gewerk} required /></div>
            <div className="space-y-2"><Label>Beschreibung</Label><Textarea name="description" defaultValue={takt.description ?? ''} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label>Plan-Start</Label><DatePicker name="plannedStart" required value={editPlannedStart || takt.plannedStart} onChange={setEditPlannedStart} /></div>
              <div className="space-y-2">
                <Label>Dauer (Arbeitstage)</Label>
                <Input
                  name="durationDays"
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={editDurationDays}
                  placeholder="z.B. 5"
                  onChange={(event) => setEditDurationDays(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Plan-Ende</Label>
              <DatePicker
                name="plannedEnd"
                required={!editDurationDays}
                value={editPlannedEnd || takt.plannedEnd}
                onChange={(value) => {
                  setEditPlannedEnd(value);
                  setEditDurationDays('');
                }}
                placeholder={editDurationDays ? 'Wird aus der Dauer berechnet…' : ''}
              />
            </div>
            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-border/50">
              <div className="space-y-2"><Label>Frühester Start <span className="text-muted-foreground font-normal">(Puffer)</span></Label><DatePicker name="earliestStart" value={editEarliestStart} onChange={setEditEarliestStart} /></div>
              <div className="space-y-2"><Label>Spätestes Ende <span className="text-muted-foreground font-normal">(Puffer)</span></Label><DatePicker name="latestEnd" value={editLatestEnd} onChange={setEditLatestEnd} /></div>
            </div>
            <div className="pt-3 border-t border-border/50 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm">🔒</span>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Interne Informationen</span>
                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Nicht an AN übermittelt</span>
              </div>
              <div className="space-y-2"><Label>Interne Notiz</Label><Textarea name="internalNote" value={editInternalNote} onChange={(event) => setEditInternalNote(event.target.value)} placeholder="Interne Hinweise für das GU-Team…" /></div>
              <div className="space-y-2"><Label>Kostenschätzung</Label><Input name="costEstimate" value={editCostEstimate} onChange={(event) => setEditCostEstimate(event.target.value)} placeholder="z.B. 45.000 €" /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Vergabepriorität</Label>
                  <Select value={editProcurementPriority} onValueChange={setEditProcurementPriority}>
                    <SelectTrigger><SelectValue placeholder="Keine" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HIGH">Hoch</SelectItem>
                      <SelectItem value="MEDIUM">Mittel</SelectItem>
                      <SelectItem value="LOW">Niedrig</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Risikoklasse</Label>
                  <Select value={editRiskClassification} onValueChange={setEditRiskClassification}>
                    <SelectTrigger><SelectValue placeholder="Keine" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A — Hoch</SelectItem>
                      <SelectItem value="B">B — Mittel</SelectItem>
                      <SelectItem value="C">C — Niedrig</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </form>
          <DialogFooter>
            <Button type="button" variant="destructive" className="mr-auto" onClick={handleDelete} disabled={deleteTakt.isPending}>
              {deleteTakt.isPending ? 'Löscht…' : 'Leistung löschen'}
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Abbrechen</Button>
            <Button type="submit" form="takt-edit-form" disabled={updateTakt.isPending}>{updateTakt.isPending ? 'Speichert…' : 'Speichern'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={(open) => {
        setAssignOpen(open);
        if (!open) {
          setSelectedNuIds([]);
          setPublicationId('');
          setSelectedPolicyKey('');
          setResponseRequiredBy('');
        }
      }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Leistung vergeben</DialogTitle></DialogHeader>
          <form id="takt-assign-form" onSubmit={handleAssign} className="space-y-4">
            <div className="space-y-2">
              <Label>Nachunternehmer</Label>
              <div className="rounded-md border divide-y">
                {assignablePartners.map((partner) => {
                  const checked = selectedNuIds.includes(partner.id);
                  return (
                    <label key={partner.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer">
                      <input type="checkbox" checked={checked} onChange={() => setSelectedNuIds((current) => checked ? current.filter((id) => id !== partner.id) : [...current, partner.id])} />
                      {partner.name}
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Nutzungsrichtlinie *</Label>
              <Select
                value={selectedPolicy ? `${selectedPolicy.code}:${selectedPolicy.version}` : selectedPolicyKey}
                onValueChange={(value) => {
                  setSelectedPolicyKey(value);
                  setPublicationId('');
                }}
                disabled={schedulePolicies.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Policy auswählen…" />
                </SelectTrigger>
                <SelectContent>
                  {schedulePolicies.map((policy) => (
                    <SelectItem key={`${policy.code}-${policy.version}`} value={`${policy.code}:${policy.version}`}>
                      {policy.name} · v{policy.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Die Veröffentlichung muss diese Policy für die Rahmentermin-Abstimmung verwenden.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Veröffentlichte Leistungsinformationen *</Label>
              <Select value={publicationId} onValueChange={setPublicationId}>
                <SelectTrigger><SelectValue placeholder={selectedNuIds.length ? 'Veröffentlichung auswählen…' : 'Erst AN auswählen'} /></SelectTrigger>
                <SelectContent>{eligiblePublications.map((publication) => <SelectItem key={publication.id} value={publication.id}>{publication.title} (v{publication.version})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea name="message" placeholder="Hinweis (optional)" />
            <div className="space-y-2">
              <Label>Antwortfrist (optional)</Label>
              <DatePicker includeTime value={responseRequiredBy} onChange={setResponseRequiredBy} min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)} />
            </div>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Abbrechen</Button>
            <Button type="submit" form="takt-assign-form" disabled={savingAssignment || !publicationId}>{savingAssignment ? 'Vergibt…' : 'Vergeben'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}