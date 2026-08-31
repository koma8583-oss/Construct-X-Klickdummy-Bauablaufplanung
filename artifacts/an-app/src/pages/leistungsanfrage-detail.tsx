import { useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  FileCheck2,
  Info,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  getGetAnLeistungsanfrageDetailsQueryKey,
  getGetLeistungsanfrageLatestAvailabilityCheckQueryKey,
  getListLeistungsanfrageResourceRequirementsQueryKey,
  TaktDecision,
  TaktResponseReasonCode,
  type AnLeistungsanfrageDetails,
  type AnLeistungsanfrageResourceRequirement,
  type NuResponseCreate,
  useCreateLeistungsanfrageResourceRequirement,
  useDeleteLeistungsanfrageResourceRequirement,
  useGetAnLeistungsanfrageDetails,
  useGetLeistungsanfrageLatestAvailabilityCheck,
  useListLeistungsanfrageResourceRequirements,
  useListResourceTypes,
  useRunLeistungsanfrageAvailabilityCheck,
  useSubmitLeistungsanfrageResponse,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const EMPTY = "Nicht veröffentlicht";
const STATUS_LABELS: Record<string, string> = {
  RECEIVED: "Eingegangen",
  DETAILS_RETRIEVED: "Daten abgerufen",
  UNDER_REVIEW: "In Prüfung",
  RESPONDED: "Beantwortet",
  REVISION_REQUIRED: "Überarbeitung angefragt",
  CONFIRMED: "Bestätigt",
  CANCELLED: "Storniert",
  SUPERSEDED: "Ersetzt",
  EXPIRED: "Abgelaufen",
};
const STATUS_TONE: Record<string, string> = {
  RECEIVED: "border-cyan-700/20 bg-cyan-700/10 text-cyan-800 dark:text-cyan-200",
  DETAILS_RETRIEVED: "border-amber-600/20 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  UNDER_REVIEW: "border-amber-600/20 bg-amber-500/10 text-amber-800 dark:text-amber-200",
  RESPONDED: "border-slate-500/20 bg-slate-500/10 text-slate-700 dark:text-slate-200",
  REVISION_REQUIRED: "border-orange-600/20 bg-orange-500/10 text-orange-800 dark:text-orange-200",
  CONFIRMED: "border-emerald-700/20 bg-emerald-600/10 text-emerald-800 dark:text-emerald-200",
  CANCELLED: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  SUPERSEDED: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300",
  EXPIRED: "border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300",
};

function dateText(value?: string | null, withTime = false) {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return format(date, withTime ? "dd.MM.yyyy, HH:mm 'Uhr'" : "dd.MM.yyyy", { locale: de });
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function values(...items: unknown[]) {
  const found = items.find((item) => typeof item === "string" && item.trim());
  return typeof found === "string" ? found : EMPTY;
}
function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}
function read(source: Record<string, unknown>, ...keys: string[]) {
  return values(...keys.map((key) => source[key]));
}

function StatusBadge({ status }: { status: string }) {
  return <Badge data-testid="status-detail" variant="outline" className={`font-medium ${STATUS_TONE[status] ?? "border-border text-muted-foreground"}`}>{STATUS_LABELS[status] ?? "Status nicht veröffentlicht"}</Badge>;
}

type StepState = "done" | "current" | "open";
function WorkflowStep({ number, title, why, state, outcome, children }: { number: number; title: string; why: string; state: StepState; outcome: string; children: ReactNode }) {
  return (
    <section data-testid={`workflow-step-${number}`} className={`overflow-hidden rounded-2xl border bg-card transition-shadow ${state === "current" ? "border-primary/45 shadow-md" : "border-border shadow-sm"}`}>
      <div className="flex gap-4 border-b border-border/70 px-5 py-4 sm:px-6">
        <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-bold ${state === "done" ? "bg-emerald-600 text-white" : state === "current" ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>{state === "done" ? <Check className="h-4 w-4" /> : number}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{title}</h2><span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{state === "done" ? "Erledigt" : state === "current" ? "Nächster Schritt" : "Ausstehend"}</span></div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{why}</p>
          <p data-testid={`step-outcome-${number}`} className="mt-2 text-xs font-medium">{outcome}</p>
        </div>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function SnapshotGroups({ details }: { details: AnLeistungsanfrageDetails }) {
  const snap = object(details.snapshotPayload);
  const service = object(snap.leistung ?? snap.service ?? snap.workPackage);
  const project = object(snap.project ?? snap.projekt);
  const location = object(snap.location ?? snap.ort);
  const timeWindow = object(snap.plannedTimeWindow ?? snap.timeWindow ?? snap.zeitfenster);
  const buffer = object(snap.bufferTimeWindow ?? snap.buffer ?? snap.puffer);
  const policy = object(details.policySnapshot);
  const policyPermissions = array(policy.permissions).filter((item): item is string => typeof item === "string");
  const policyProhibitions = array(policy.prohibitions).filter((item): item is string => typeof item === "string");
  const predecessors = array(snap.predecessors ?? snap.predecessor ?? snap.vorgaenger ?? snap["vorgänger"]);
  const successors = array(snap.successors ?? snap.successor ?? snap.nachfolger);
  const dependencies = [
    ...predecessors.map((item) => ({ value: item, label: "Vorgänger" })),
    ...successors.map((item) => ({ value: item, label: "Nachfolger" })),
  ];
  const projectName = values(project.name, snap.projectName, details.project.name);
  const projectDescription = values(project.description, snap.projectDescription);
  const place = values(location.name, location.address, location.description, snap.projectLocation, details.project.location);
  const serviceName = values(service.name, service.title, snap.kurzbezeichnung, snap.workPackage, snap.taktBezeichnung, details.takt.kurzbezeichnung, details.takt.taktBezeichnung);
  const serviceDescription = values(service.description, snap.requiredOutput, snap.description);
  const start = values(timeWindow.start, snap.plannedStart, details.plannedStart);
  const end = values(timeWindow.end, snap.plannedEnd, details.plannedEnd);
  const earliest = values(buffer.earliestStart, buffer.start, snap.earliestStart);
  const latest = values(buffer.latestEnd, buffer.end, snap.latestEnd);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-background/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Projekt</p>
          <p data-testid="snapshot-project" className="mt-2 font-semibold">{projectName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{projectDescription}</p>
          <p className="mt-3 flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{place}</p>
        </div>
        <div className="rounded-xl border border-border bg-background/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Leistung</p>
          <p data-testid="snapshot-service" className="mt-2 font-semibold">{serviceName}</p>
          <p className="mt-1 text-sm text-muted-foreground">{serviceDescription}</p>
          <p className="mt-3 text-sm"><span className="text-muted-foreground">Gewerk / Zone: </span>{values(snap.gewerk, snap.trade, details.takt.gewerk)} / {values(location.zone, snap.zone, details.takt.zone)}</p>
        </div>
      </div>
      {(Object.keys(policy).length > 0) && <div className="rounded-xl border border-primary/15 bg-primary/5 p-4"><div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />Freigegebene Nutzungsrichtlinie</div><p className="mt-2 text-sm">{values(policy.name, policy.title)}</p>{typeof policy.purpose === "string" && <p className="mt-1 text-xs text-muted-foreground">{policy.purpose}</p>}{policyPermissions.length > 0 && <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Erlaubt:</span> {policyPermissions.join(", ")}</p>}{policyProhibitions.length > 0 && <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Nicht erlaubt:</span> {policyProhibitions.join(", ")}</p>}</div>}
      <div className="rounded-xl border border-border bg-background/60 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-primary" />Zeitfenster und Puffer</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><p className="text-xs text-muted-foreground">Geplantes Fenster</p><p className="mt-1 text-sm font-medium">{dateText(start)} – {dateText(end)}</p></div>
          <div><p className="text-xs text-muted-foreground">Veröffentlichter Puffer</p><p className="mt-1 text-sm font-medium">{earliest === EMPTY && latest === EMPTY ? EMPTY : `${dateText(earliest)} – ${dateText(latest)}`}</p></div>
        </div>
      </div>
      <div className="rounded-xl border border-dashed border-border/80 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><ArrowRight className="h-4 w-4 text-primary" />Vorgänger und Nachfolger</div>
        {dependencies.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Keine Vorgänger oder Nachfolger veröffentlicht.</p> : <div className="mt-3 grid gap-2 sm:grid-cols-2">{dependencies.map((item, index) => { const dep = object(item.value); const nested = object(dep.predecessor ?? dep.successor ?? dep.vorgaenger ?? dep.nachfolger); const nestedLabel = read(nested, "name", "title", "taktBezeichnung"); const directLabel = read(dep, "name", "title", "taktBezeichnung"); const label = nestedLabel !== EMPTY ? nestedLabel : directLabel !== EMPTY ? directLabel : "Referenz nicht veröffentlicht"; return <div data-testid={`dependency-${index}`} key={`${label}-${index}`} className="rounded-lg bg-muted/60 px-3 py-2 text-sm">{label}<span className="ml-2 text-xs text-muted-foreground">{item.label}</span></div>; })}</div>}
      </div>
    </div>
  );
}

function ResourceSection({ id, requirements, canEdit, defaultStart, defaultEnd, loadError }: { id: string; requirements: AnLeistungsanfrageResourceRequirement[]; canEdit: boolean; defaultStart: string; defaultEnd: string; loadError?: boolean }) {
  const [showAdd, setShowAdd] = useState(false);
  const [resourceTypeId, setResourceTypeId] = useState("");
  const [capacity, setCapacity] = useState("");
  const [utilization, setUtilization] = useState("100");
  const [qualification, setQualification] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const client = useQueryClient();
  const typeQuery = useListResourceTypes();
  const create = useCreateLeistungsanfrageResourceRequirement();
  const remove = useDeleteLeistungsanfrageResourceRequirement();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListLeistungsanfrageResourceRequirementsQueryKey(id) });
    void client.invalidateQueries({ queryKey: getGetAnLeistungsanfrageDetailsQueryKey(id) });
  };
  const add = () => {
    if (!resourceTypeId || !capacity || !(periodStart || defaultStart) || !(periodEnd || defaultEnd)) {
      toast({ title: "Angaben fehlen", description: "Ressourcentyp, Kapazität und Zeitraum sind erforderlich.", variant: "destructive" });
      return;
    }
    create.mutate({ leistungsanfrageId: id, data: { resourceTypeId, requiredCapacity: Number(capacity), utilizationPercent: Number(utilization), requiredQualification: qualification || null, periodStart: periodStart || defaultStart, periodEnd: periodEnd || defaultEnd, notes: notes || null } }, {
      onSuccess: () => { toast({ title: "Ressourcenbedarf gespeichert" }); setShowAdd(false); setResourceTypeId(""); setCapacity(""); setQualification(""); setPeriodStart(""); setPeriodEnd(""); setNotes(""); refresh(); },
      onError: () => toast({ title: "Ressourcenbedarf konnte nicht gespeichert werden", description: "Bitte prüfen Sie die Angaben.", variant: "destructive" }),
    });
  };
  const removeRow = (requirementId: string) => {
    if (!window.confirm("Ressourcenbedarf wirklich entfernen?")) return;
    remove.mutate({ leistungsanfrageId: id, reqId: requirementId }, { onSuccess: () => { toast({ title: "Ressourcenbedarf entfernt" }); refresh(); }, onError: () => toast({ title: "Ressourcenbedarf konnte nicht entfernt werden", variant: "destructive" }) });
  };
  return (
    <div>
      {loadError && <p className="mb-3 rounded-lg border border-amber-600/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Ressourcenbedarf konnte nicht aktualisiert werden. Bereits veröffentlichte Angaben bleiben sichtbar.</p>}
      {requirements.length === 0 ? <div className="rounded-xl border border-dashed border-border/80 p-5 text-sm text-muted-foreground">Für diese Leistungsanfrage ist noch kein Ressourcenbedarf erfasst. Wenn Sie für die Prüfung Bedarf benötigen, ergänzen Sie ihn hier.</div> : <div className="space-y-2">{requirements.map((req) => <div data-testid={`resource-row-${req.id}`} key={req.id} className="flex items-start gap-3 rounded-xl border border-border bg-background/70 p-3"><Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="font-medium">{values(req.resourceTypeName, req.resourceTypeCode)}</p><p className="mt-1 text-xs text-muted-foreground">{String(req.requiredCapacity ?? EMPTY)} {req.capacityUnit ?? ""} · {req.utilizationPercent ? `${req.utilizationPercent}% Auslastung` : "Auslastung nicht veröffentlicht"} · {dateText(req.periodStart)} – {dateText(req.periodEnd)}</p>{req.requiredQualification && <p className="mt-1 text-xs text-muted-foreground">Qualifikation: {req.requiredQualification}</p>}{req.notes && <p className="mt-1 text-xs text-muted-foreground">{req.notes}</p>}</div>{canEdit && <Button data-testid={`button-delete-resource-${req.id}`} variant="ghost" size="icon" disabled={remove.isPending} onClick={() => removeRow(req.id)} aria-label="Ressourcenbedarf entfernen"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}</div>)}</div>}
      {canEdit && (!showAdd ? <Button data-testid="button-add-resource" className="mt-4" variant="outline" size="sm" onClick={() => setShowAdd(true)}><Plus className="mr-2 h-4 w-4" />Ressourcenbedarf ergänzen</Button> : <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold">Bedarf ergänzen</p><Button data-testid="button-close-resource" variant="ghost" size="icon" onClick={() => setShowAdd(false)}><X className="h-4 w-4" /></Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Label>Ressourcentyp</Label><Select value={resourceTypeId} onValueChange={setResourceTypeId}><SelectTrigger data-testid="select-resource-type" className="mt-1"><SelectValue placeholder="Typ auswählen" /></SelectTrigger><SelectContent>{typeQuery.data?.items.filter((item) => item.active).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}{item.code ? ` · ${item.code}` : ""}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="resource-capacity">Kapazität</Label><Input data-testid="input-resource-capacity" id="resource-capacity" className="mt-1" type="number" min="0.01" step="0.01" value={capacity} onChange={(event) => setCapacity(event.target.value)} placeholder="z. B. 2" /></div><div><Label htmlFor="resource-utilization">Auslastung in Prozent</Label><Input data-testid="input-resource-utilization" id="resource-utilization" className="mt-1" type="number" min="1" max="100" value={utilization} onChange={(event) => setUtilization(event.target.value)} /></div><div><Label htmlFor="resource-start">Von</Label><Input data-testid="input-resource-start" id="resource-start" className="mt-1" type="date" value={periodStart || defaultStart} onChange={(event) => setPeriodStart(event.target.value)} /></div><div><Label htmlFor="resource-end">Bis</Label><Input data-testid="input-resource-end" id="resource-end" className="mt-1" type="date" value={periodEnd || defaultEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></div><div className="sm:col-span-2"><Label htmlFor="resource-qualification">Qualifikation</Label><Input data-testid="input-resource-qualification" id="resource-qualification" className="mt-1" value={qualification} onChange={(event) => setQualification(event.target.value)} placeholder="Optional" /></div><div className="sm:col-span-2"><Label htmlFor="resource-notes">Hinweis</Label><Textarea data-testid="input-resource-notes" id="resource-notes" className="mt-1" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optionaler Hinweis zum Bedarf" /></div></div><Button data-testid="button-save-resource" className="mt-4" disabled={create.isPending} onClick={add}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Bedarf speichern</Button></div>)}
    </div>
  );
}

function AvailabilitySection({ id, canRespond, latest, defaultStart, defaultEnd, loadError }: { id: string; canRespond: boolean; latest: any; defaultStart: string; defaultEnd: string; loadError?: boolean }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const run = useRunLeistungsanfrageAvailabilityCheck();
  const publicResult = latest?.publicResult;
  const runCheck = () => run.mutate({ leistungsanfrageId: id }, { onSuccess: () => { toast({ title: "Verfügbarkeitsprüfung aktualisiert" }); void client.invalidateQueries({ queryKey: getGetLeistungsanfrageLatestAvailabilityCheckQueryKey(id) }); }, onError: () => toast({ title: "Verfügbarkeitsprüfung konnte nicht gestartet werden", description: "Bitte versuchen Sie es erneut.", variant: "destructive" }) });
  const outcome = latest?.status === "COMPLETED" ? `Letzte Prüfung: ${publicResult?.result === "FEASIBLE" ? "Machbar" : publicResult?.result === "FEASIBLE_WITH_ALTERNATIVES" ? "Mit Alternativen" : "Nicht machbar"}` : latest?.status === "RUNNING" || latest?.status === "PENDING" ? "Prüfung läuft." : "Noch keine Prüfung für diesen Arbeitsauftrag.";
  return <div>{loadError && <p className="mb-3 rounded-lg border border-amber-600/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Das letzte Prüfergebnis konnte nicht geladen werden. Sie können die Prüfung erneut starten.</p>}<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${publicResult?.result === "FEASIBLE" ? "bg-emerald-600/10 text-emerald-700" : publicResult ? "bg-accent/30 text-primary" : "bg-muted text-muted-foreground"}`}>{latest?.status === "COMPLETED" ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}</div><div><p className="font-medium">{latest?.status === "COMPLETED" ? (publicResult?.result === "FEASIBLE" ? "Bedarf im Fenster verfügbar" : publicResult?.result === "FEASIBLE_WITH_ALTERNATIVES" ? "Alternativfenster verfügbar" : "Im Fenster nicht verfügbar") : "Prüfung noch nicht ausgeführt"}</p><p className="mt-1 text-sm text-muted-foreground">Nur das veröffentlichte Ergebnis und mögliche Alternativfenster werden hier angezeigt.</p></div></div><Button data-testid="button-run-availability" variant="outline" disabled={run.isPending || !canRespond} onClick={runCheck}>{run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}{latest ? "Erneut prüfen" : "Prüfung starten"}</Button></div>{publicResult?.alternatives?.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Veröffentlichte Alternativen</p>{publicResult.alternatives.map((item: any) => <div key={item.alternativeId} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm"><span>Rang {item.rank}</span><span className="font-medium">{dateText(item.timeWindow?.start ?? defaultStart)} – {dateText(item.timeWindow?.end ?? defaultEnd)}</span></div>)}</div>}<p className="mt-4 text-xs font-medium text-muted-foreground">{outcome}</p></div>;
}

function ResponseForm({ id, canRespond, defaultStart, defaultEnd }: { id: string; canRespond: boolean; defaultStart: string; defaultEnd: string }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const submit = useSubmitLeistungsanfrageResponse();
  const [decision, setDecision] = useState<"" | "ACCEPTED" | "ALTERNATIVES_PROPOSED" | "REJECTED">("");
  const [acceptStart, setAcceptStart] = useState("");
  const [acceptEnd, setAcceptEnd] = useState("");
  const [alternatives, setAlternatives] = useState([{ start: "", end: "" }]);
  const [reasonCode, setReasonCode] = useState("");
  const [comment, setComment] = useState("");
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!decision) return;
    if (decision === "ACCEPTED" && (!acceptStart || !acceptEnd || acceptEnd < acceptStart)) { toast({ title: "Zeitfenster prüfen", description: "Beginn und Ende des angenommenen Fensters sind erforderlich.", variant: "destructive" }); return; }
    if (decision === "REJECTED" && !reasonCode) { toast({ title: "Grund auswählen", description: "Bitte wählen Sie einen allgemeinen Ablehnungsgrund.", variant: "destructive" }); return; }
    if (decision === "ALTERNATIVES_PROPOSED" && alternatives.some((item) => !item.start || !item.end || item.end < item.start)) { toast({ title: "Alternativen prüfen", description: "Jede Alternative benötigt ein gültiges Zeitfenster.", variant: "destructive" }); return; }
    const payload: NuResponseCreate = { decision: decision as TaktDecision };
    if (decision === "ACCEPTED") payload.acceptedTimeWindow = { start: acceptStart, end: acceptEnd };
    if (decision === "ALTERNATIVES_PROPOSED") payload.alternatives = alternatives.map((item, index) => ({ alternativeId: `alternative-${index + 1}`, rank: index + 1, timeWindow: item }));
    if (decision === "REJECTED") payload.reasonCode = reasonCode as typeof TaktResponseReasonCode[keyof typeof TaktResponseReasonCode];
    if (comment.trim()) payload.comment = comment.trim();
    submit.mutate({ leistungsanfrageId: id, data: payload }, { onSuccess: () => { toast({ title: "Antwort übermittelt" }); void client.invalidateQueries({ queryKey: getGetAnLeistungsanfrageDetailsQueryKey(id) }); }, onError: () => toast({ title: "Antwort konnte nicht übermittelt werden", description: "Bitte prüfen Sie die Angaben und versuchen Sie es erneut.", variant: "destructive" }) });
  };
  if (!canRespond) return <p className="rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">Die Antwortaktion ist für diesen Status abgeschlossen.</p>;
  return <form data-testid="response-form" onSubmit={send} className="space-y-4"><div className="grid gap-2 sm:grid-cols-3"><button data-testid="button-decision-accepted" type="button" onClick={() => { setDecision("ACCEPTED"); setAcceptStart(acceptStart || defaultStart); setAcceptEnd(acceptEnd || defaultEnd); }} className={`rounded-xl border p-3 text-left text-sm ${decision === "ACCEPTED" ? "border-emerald-600 bg-emerald-600/10" : "border-border hover:border-primary/40"}`}><CheckCircle2 className="mb-2 h-4 w-4 text-emerald-700" /><span className="font-semibold">Annehmen</span><span className="mt-1 block text-xs text-muted-foreground">Im genannten Fenster</span></button><button data-testid="button-decision-alternative" type="button" onClick={() => setDecision("ALTERNATIVES_PROPOSED")} className={`rounded-xl border p-3 text-left text-sm ${decision === "ALTERNATIVES_PROPOSED" ? "border-amber-600 bg-amber-500/10" : "border-border hover:border-primary/40"}`}><CalendarDays className="mb-2 h-4 w-4 text-amber-700" /><span className="font-semibold">Alternative</span><span className="mt-1 block text-xs text-muted-foreground">Bis zu drei Fenster</span></button><button data-testid="button-decision-rejected" type="button" onClick={() => setDecision("REJECTED")} className={`rounded-xl border p-3 text-left text-sm ${decision === "REJECTED" ? "border-destructive bg-destructive/10" : "border-border hover:border-primary/40"}`}><X className="mb-2 h-4 w-4 text-destructive" /><span className="font-semibold">Ablehnen</span><span className="mt-1 block text-xs text-muted-foreground">Mit allgemeinem Grund</span></button></div>{decision === "ACCEPTED" && <div className="grid gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:grid-cols-2"><div><Label htmlFor="accepted-start">Beginn</Label><Input data-testid="input-accepted-start" id="accepted-start" className="mt-1" type="date" value={acceptStart} onChange={(event) => setAcceptStart(event.target.value)} /></div><div><Label htmlFor="accepted-end">Ende</Label><Input data-testid="input-accepted-end" id="accepted-end" className="mt-1" type="date" value={acceptEnd} onChange={(event) => setAcceptEnd(event.target.value)} /></div></div>}{decision === "ALTERNATIVES_PROPOSED" && <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold">Alternative Zeitfenster</p>{alternatives.length < 3 && <Button data-testid="button-add-alternative" type="button" size="sm" variant="outline" onClick={() => setAlternatives([...alternatives, { start: "", end: "" }])}><Plus className="mr-1 h-3.5 w-3.5" />Alternative</Button>}</div>{alternatives.map((item, index) => <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><div><Label htmlFor={`alternative-start-${index}`}>Beginn {index + 1}</Label><Input data-testid={`input-alternative-start-${index}`} id={`alternative-start-${index}`} className="mt-1" type="date" value={item.start} onChange={(event) => setAlternatives(alternatives.map((row, rowIndex) => rowIndex === index ? { ...row, start: event.target.value } : row))} /></div><div><Label htmlFor={`alternative-end-${index}`}>Ende {index + 1}</Label><Input data-testid={`input-alternative-end-${index}`} id={`alternative-end-${index}`} className="mt-1" type="date" value={item.end} onChange={(event) => setAlternatives(alternatives.map((row, rowIndex) => rowIndex === index ? { ...row, end: event.target.value } : row))} /></div>{alternatives.length > 1 && <Button data-testid={`button-remove-alternative-${index}`} type="button" variant="ghost" size="icon" className="self-end" onClick={() => setAlternatives(alternatives.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button>}</div>)}</div>}{decision === "REJECTED" && <div className="rounded-xl border border-border bg-muted/40 p-4"><Label>Ablehnungsgrund</Label><Select value={reasonCode} onValueChange={setReasonCode}><SelectTrigger data-testid="select-reason-code" className="mt-1"><SelectValue placeholder="Allgemeinen Grund auswählen" /></SelectTrigger><SelectContent><SelectItem value={TaktResponseReasonCode.RESOURCE_CONFLICT}>Ressourcenkonflikt</SelectItem><SelectItem value={TaktResponseReasonCode.NO_CAPACITY}>Keine Kapazität</SelectItem><SelectItem value={TaktResponseReasonCode.EQUIPMENT_UNAVAILABLE}>Gerät nicht verfügbar</SelectItem><SelectItem value={TaktResponseReasonCode.QUALIFICATION_MISSING}>Qualifikation fehlt</SelectItem><SelectItem value={TaktResponseReasonCode.TIME_WINDOW_TOO_SHORT}>Zeitfenster zu kurz</SelectItem><SelectItem value={TaktResponseReasonCode.OUTSIDE_PLANNING_HORIZON}>Außerhalb des Planungshorizonts</SelectItem><SelectItem value={TaktResponseReasonCode.OTHER}>Sonstiger allgemeiner Grund</SelectItem></SelectContent></Select></div>}<div><Label htmlFor="response-comment">Kommentar <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea data-testid="input-response-comment" id="response-comment" className="mt-1" maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Nur veröffentlichbare Hinweise" /></div><div className="flex justify-end"><Button data-testid="button-submit-response" type="submit" disabled={submit.isPending || !decision}>{submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Antwort übermitteln</Button></div></form>;
}

function TerminalNotice({ status }: { status: string }) {
  const copy: Record<string, [string, string]> = {
    RESPONDED: ["Antwort bereits übermittelt", "Diese Leistungsanfrage ist beantwortet. Eine erneute Antwort ist nicht möglich."],
    CONFIRMED: ["Leistung bestätigt", "Der Auftraggeber hat die Abstimmung bestätigt. Diese Anfrage ist abgeschlossen."],
    CANCELLED: ["Anfrage storniert", "Der Auftraggeber hat diese Leistungsanfrage beendet. Es ist keine Aktion erforderlich."],
    SUPERSEDED: ["Anfrage ersetzt", "Diese Leistungsanfrage wurde durch eine neuere Koordinationsrunde ersetzt."],
    EXPIRED: ["Antwortfrist abgelaufen", "Die veröffentlichte Antwortfrist ist abgelaufen. Es ist keine reguläre Antwort mehr möglich."],
  };
  const [title, description] = copy[status] ?? ["Anfrage abgeschlossen", "Für diese Anfrage ist derzeit keine Antwortaktion möglich."];
  return <div data-testid="terminal-notice" className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 p-5"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p></div></div>;
}

export default function LeistungsanfrageDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const id = requestId ?? "";
  const detailQuery = useGetAnLeistungsanfrageDetails(id, { query: { enabled: !!id, queryKey: getGetAnLeistungsanfrageDetailsQueryKey(id) } });
  const requirementQuery = useListLeistungsanfrageResourceRequirements(id, { query: { enabled: !!id, queryKey: getListLeistungsanfrageResourceRequirementsQueryKey(id) } });
  const availabilityQuery = useGetLeistungsanfrageLatestAvailabilityCheck(id, { query: { enabled: !!id, queryKey: getGetLeistungsanfrageLatestAvailabilityCheckQueryKey(id) } });
  const details = detailQuery.data;
  if (detailQuery.isLoading) return <main className="mx-auto max-w-7xl space-y-6 p-5 lg:p-8"><Skeleton className="h-8 w-32" /><Skeleton className="h-28 w-full" /><div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"><div className="space-y-4"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div><Skeleton className="h-80 w-full" /></div></main>;
  if (detailQuery.isError || !details) return <main className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 p-6 text-center"><AlertTriangle className="h-10 w-10 text-destructive" /><h1 className="text-lg font-semibold">Leistungsanfrage nicht verfügbar</h1><p className="text-sm text-muted-foreground">Die Anfrage konnte nicht geöffnet werden oder ist nicht mehr verfügbar.</p><div className="flex gap-2"><Button data-testid="button-back-error" variant="outline" onClick={() => setLocation("/leistungsanfragen")}><ArrowLeft className="mr-2 h-4 w-4" />Zur Inbox</Button><Button data-testid="button-retry-detail" variant="secondary" onClick={() => void detailQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Erneut laden</Button></div></main>;

  const snap = object(details.snapshotPayload);
  const service = object(snap.leistung ?? snap.service ?? snap.workPackage);
  const title = values(service.kurzbezeichnung, snap.kurzbezeichnung, details.takt.kurzbezeichnung, details.takt.taktBezeichnung);
  const window = object(snap.plannedTimeWindow ?? snap.timeWindow ?? snap.zeitfenster);
  const defaultStart = typeof window.start === "string" ? window.start.slice(0, 10) : details.plannedStart.slice(0, 10);
  const defaultEnd = typeof window.end === "string" ? window.end.slice(0, 10) : details.plannedEnd.slice(0, 10);
  const requirements = (requirementQuery.data ?? details.resourceRequirements) as AnLeistungsanfrageResourceRequirement[];
  const latest = availabilityQuery.data;
  const status = details.status;
  const terminal = ["RESPONDED", "CONFIRMED", "CANCELLED", "SUPERSEDED", "EXPIRED"].includes(status);
  const canRespond = !terminal && ["RECEIVED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"].includes(status);
  const currentStep = !details.detailsRetrievedAt ? 2 : requirements.length === 0 ? 3 : latest?.status !== "COMPLETED" ? 4 : canRespond ? 5 : 5;
  const states: StepState[] = [ "done", details.detailsRetrievedAt ? "done" : "current", requirements.length > 0 ? "done" : currentStep === 3 ? "current" : "open", latest?.status === "COMPLETED" ? "done" : currentStep === 4 ? "current" : "open", terminal ? "done" : currentStep === 5 ? "current" : "open" ];
  const availabilityOutcome = latest?.status === "COMPLETED" ? "Prüfung abgeschlossen" : latest?.status === "RUNNING" ? "Prüfung läuft." : "Noch keine Prüfung für diesen Arbeitsauftrag.";

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-5 pb-12 lg:p-8">
      <Button data-testid="button-back-inbox" variant="ghost" className="-ml-3 gap-2 text-muted-foreground" onClick={() => setLocation("/leistungsanfragen")}><ArrowLeft className="h-4 w-4" />Zurück zur Inbox</Button>
      <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-start md:justify-between"><div><div className="flex flex-wrap items-center gap-3"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary">ARBEITSAUFTRAG / {details.requestNumber}</p><StatusBadge status={status} /></div><h1 data-testid="text-detail-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Prüfen Sie die freigegebenen Daten, ordnen Sie den eigenen Bedarf ein und senden Sie eine klare Rückmeldung.</p></div><div className="rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-sm"><p className="text-[11px] text-muted-foreground">Antwortfrist</p><p data-testid="detail-deadline" className={`mt-1 font-semibold ${details.responseRequiredBy && new Date(details.responseRequiredBy) < new Date() ? "text-destructive" : ""}`}>{dateText(details.responseRequiredBy, true)}</p></div></header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          {terminal && <TerminalNotice status={status} />}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm"><div className="mb-4 flex items-center justify-between"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.17em] text-muted-foreground">Prüfpfad</p><span className="text-xs text-muted-foreground">Schritt {currentStep} von 5</span></div><div className="grid grid-cols-5 gap-1">{states.map((state, index) => <div key={index} className={`h-1.5 rounded-full ${state === "done" ? "bg-emerald-600" : state === "current" ? "bg-accent" : "bg-muted"}`} />)}</div></div>
          <WorkflowStep number={1} title="Freigegebene Daten" why="Dieser Schritt trennt veröffentlichte Arbeitsgrundlagen von internen Planungsdaten." state={states[0]} outcome="Zugriff auf diesen veröffentlichten Snapshot ist möglich."><div className="flex items-start gap-3 rounded-xl border border-emerald-700/20 bg-emerald-600/10 p-4 text-sm"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700 dark:text-emerald-300" /><div><p className="font-medium">Datenfreigabe geprüft</p><p className="mt-1 text-muted-foreground">Schema {details.schemaVersion || EMPTY} · Abgerufen {dateText(details.detailsRetrievedAt, true)}</p></div></div></WorkflowStep>
          <WorkflowStep number={2} title="Leistungsdaten prüfen" why="Hier sehen Sie die veröffentlichte Grundlage für Ihre Disposition. Nicht veröffentlichte Felder bleiben ausdrücklich leer." state={states[1]} outcome={details.detailsRetrievedAt ? `Snapshot abgerufen am ${dateText(details.detailsRetrievedAt, true)}` : "Snapshot wird nach der Freigabe abgerufen."}><SnapshotGroups details={details} /></WorkflowStep>
          <WorkflowStep number={3} title="Ressourcenbedarf einordnen" why="Der eigene Bedarf macht die Verfügbarkeitsprüfung nachvollziehbar. Ergänzungen bleiben auf die AN-Seite begrenzt." state={states[2]} outcome={requirements.length > 0 ? `${requirements.length} Bedarf${requirements.length === 1 ? "" : "e"} erfasst` : "Noch kein Ressourcenbedarf erfasst."}><ResourceSection id={id} requirements={requirements} canEdit={canRespond} defaultStart={defaultStart} defaultEnd={defaultEnd} loadError={requirementQuery.isError} /></WorkflowStep>
          <WorkflowStep number={4} title="Verfügbarkeit prüfen" why="Die Prüfung verdichtet Ihren erfassten Bedarf zu einer belastbaren Rückmeldung, ohne interne Konfliktdetails zu veröffentlichen." state={states[3]} outcome={availabilityOutcome}><AvailabilitySection id={id} canRespond={canRespond} latest={latest} defaultStart={defaultStart} defaultEnd={defaultEnd} loadError={availabilityQuery.isError} /></WorkflowStep>
          <WorkflowStep number={5} title="Antwort senden" why="Ihre Antwort wird auf die freigegebenen Angaben und einen allgemeinen Entscheidungsgrund begrenzt." state={states[4]} outcome={terminal ? "Antwortaktion abgeschlossen." : "Bitte wählen Sie die passende Rückmeldung."}><ResponseForm id={id} canRespond={canRespond} defaultStart={defaultStart} defaultEnd={defaultEnd} /></WorkflowStep>
        </div>
        <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <section data-testid="summary-card" className="rounded-2xl border border-border bg-card p-5 shadow-sm"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Auftrag auf einen Blick</p><h2 className="mt-2 text-lg font-semibold">{title}</h2><dl className="mt-5 space-y-4 text-sm"><div><dt className="text-xs text-muted-foreground">Auftraggeber</dt><dd className="mt-1 font-medium">{details.guOrgName || "Auftraggebername nicht veröffentlicht"}</dd></div><div><dt className="text-xs text-muted-foreground">Projekt</dt><dd className="mt-1 font-medium">{details.project.name || EMPTY}</dd><dd className="mt-1 text-xs text-muted-foreground">{details.project.location || EMPTY}</dd></div><div><dt className="text-xs text-muted-foreground">Arbeitsfenster</dt><dd className="mt-1 font-medium">{dateText(details.plannedStart)} – {dateText(details.plannedEnd)}</dd></div><div><dt className="text-xs text-muted-foreground">Version</dt><dd className="mt-1 font-medium">Leistung {details.leistungVersion ? `v${details.leistungVersion}` : EMPTY} · Takt {details.taktVersion ? `v${details.taktVersion}` : EMPTY}</dd></div></dl></section>
          <section className="rounded-2xl border border-primary/15 bg-primary/5 p-5"><div className="flex items-start gap-3"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><p className="text-sm font-semibold">Datenhoheit</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Diese Ansicht zeigt nur den unveränderlichen Snapshot und die AN-eigenen Prüfschritte. Interne AG-Planungsdaten sind nicht Bestandteil dieses Arbeitsauftrags.</p></div></div></section>
          <section className="rounded-2xl border border-border bg-card p-5 shadow-sm"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Zeitstempel</p><dl className="mt-4 space-y-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Eingegangen</dt><dd className="text-right font-medium">{dateText(details.receivedAt, true)}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Details abgerufen</dt><dd className="text-right font-medium">{dateText(details.detailsRetrievedAt, true)}</dd></div></dl></section>
        </aside>
      </div>
    </main>
  );
}