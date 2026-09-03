import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useParams } from "wouter";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRightLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Circle,
  ChevronDown,
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  DETAILS_RETRIEVED: "In Prüfung",
  UNDER_REVIEW: "In Prüfung",
  RESPONDED: "Antwort gesendet",
  REVISION_REQUIRED: "Überarbeitung erforderlich",
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

function text(...items: unknown[]) {
  const value = items.find((item) => typeof item === "string" && item.trim());
  return typeof value === "string" ? value : EMPTY;
}

function list(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function StatusBadge({ status }: { status: string }) {
  return <Badge data-testid="status-detail" variant="outline" className={`font-medium ${STATUS_TONE[status] ?? "border-border text-muted-foreground"}`}>{STATUS_LABELS[status] ?? "Status nicht veröffentlicht"}</Badge>;
}

function PolicyDecisionPanel({ details, onChanged }: { details: AnLeistungsanfrageDetails; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const policy = details as AnLeistungsanfrageDetails & {
    policyDeltaClass?: "WITHIN_BASELINE" | "REQUIRES_CONSENT" | "NOT_PERMITTED" | null;
    policyConsentStatus?: "NOT_REQUIRED" | "PENDING" | "ACCEPTED" | "REJECTED";
    policyDiff?: { summary?: unknown; changed?: unknown } | null;
    policyDetailsAvailable?: boolean;
  };
  if (policy.policyDeltaClass !== "REQUIRES_CONSENT" && policy.policyDeltaClass !== "NOT_PERMITTED") return null;
  const diff = object(policy.policyDiff);
  const summary = list(diff.summary);
  const changed = list(diff.changed);
  const decide = async (decision: "ACCEPT" | "REJECT") => {
    setBusy(true);
    try {
      await fetchJson(`/api/an/leistungsanfragen/${details.id}/policy-consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      toast({ title: decision === "ACCEPT" ? "Policy bestätigt" : "Policy abgelehnt" });
      onChanged();
    } catch (error) {
      toast({ title: "Policy-Entscheidung konnte nicht gespeichert werden", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  if (policy.policyDeltaClass === "NOT_PERMITTED") {
    return (
      <section data-testid="policy-not-permitted" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <h2 className="font-semibold">Leistungsanfrage nicht zulässig</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Diese Anfrage verlässt die vereinbarte Project Policy. Die Leistungsdetails bleiben gesperrt, bis der Auftraggeber die Project Policy ändert.
            </p>
          </div>
        </div>
      </section>
    );
  }
  if (policy.policyConsentStatus === "REJECTED") {
    return (
      <section data-testid="policy-consent-rejected" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-5">
        <div className="flex items-start gap-3">
          <X className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <h2 className="font-semibold">Abweichende Leistungsanfrage abgelehnt</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">Die Details bleiben gesperrt. Eine Ablehnung der Child-Policy beendet die aktive Projektmitgliedschaft nicht.</p>
          </div>
        </div>
      </section>
    );
  }
  if (policy.policyConsentStatus === "ACCEPTED") {
    return (
      <section data-testid="policy-consent-accepted" className="rounded-2xl border border-emerald-700/20 bg-emerald-600/5 p-4 text-sm">
        <p className="font-semibold text-emerald-800 dark:text-emerald-200">Abweichung bestätigt</p>
        <p className="mt-1 text-muted-foreground">Die Leistungsdetails sind jetzt für die Prüfung freigegeben.</p>
      </section>
    );
  }
  return (
    <section data-testid="policy-consent-panel" className="rounded-2xl border border-amber-600/25 bg-amber-500/10 p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">Bestätigung für abweichende Leistungsanfrage erforderlich</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Vor der Bestätigung sehen Sie nur die Metadaten und die konkrete Abweichung zur Project Policy.
          </p>
          {summary.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">{summary.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul>}
          {changed.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Geänderte Bereiche: {changed.join(", ")}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button data-testid="button-accept-policy" disabled={busy} onClick={() => void decide("ACCEPT")}><Check className="mr-2 h-4 w-4" />Bestätigen und Details öffnen</Button>
            <Button data-testid="button-reject-policy" disabled={busy} variant="outline" onClick={() => void decide("REJECT")}><X className="mr-2 h-4 w-4" />Ablehnen</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function RequestOverview({ details, requestedStart, requestedEnd, onReview }: { details: AnLeistungsanfrageDetails; requestedStart: string; requestedEnd: string; onReview?: () => void }) {
  const snap = object(details.snapshotPayload);
  const service = object(snap.leistung ?? snap.service ?? snap.workPackage);
  const project = object(snap.project ?? snap.projekt);
  const location = object(snap.location ?? snap.ort);
  const window = object(snap.plannedTimeWindow ?? snap.timeWindow ?? snap.zeitfenster);
  const buffer = object(snap.bufferTimeWindow ?? snap.buffer ?? snap.puffer);
  const policy = object(details.policySnapshot);
  const dependencies = [...list(snap.predecessors ?? snap.vorgaenger), ...list(snap.successors ?? snap.nachfolger)];
  const title = text(service.name, service.title, snap.kurzbezeichnung, snap.workPackage, details.takt.kurzbezeichnung, details.takt.taktBezeichnung);
  const description = text(service.description, snap.requiredOutput, snap.description);
  const projectName = text(project.name, snap.projectName, details.project.name);
  const place = text(location.name, location.address, snap.projectLocation, details.project.location);
  const policyPermissions = list(policy.permissions);
  const policyProhibitions = list(policy.prohibitions);
  const revision = (details as AnLeistungsanfrageDetails & { revision?: any }).revision;

  return (
    <section data-testid="request-overview" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div><p className="text-xs text-muted-foreground">Leistung</p><p data-testid="overview-service" className="mt-1 font-semibold">{title}</p></div>
        <div><p className="text-xs text-muted-foreground">Projekt</p><p data-testid="overview-project" className="mt-1 font-semibold">{projectName}</p></div>
        <div><p className="text-xs text-muted-foreground">Auftraggeber</p><p data-testid="overview-ag" className="mt-1 font-semibold">{details.guOrgName || EMPTY}</p></div>
        <div><p className="text-xs text-muted-foreground">Gewünschter Zeitraum</p><p data-testid="overview-period" className="mt-1 font-semibold">{dateText(requestedStart)} – {dateText(requestedEnd)}</p></div>
        <div><p className="text-xs text-muted-foreground">Antwortfrist</p><p data-testid="overview-deadline" className={`mt-1 font-semibold ${details.responseRequiredBy && new Date(details.responseRequiredBy) < new Date() ? "text-destructive" : ""}`}>{dateText(details.responseRequiredBy, true)}</p></div>
        <div><p className="text-xs text-muted-foreground">Status</p><div className="mt-1"><StatusBadge status={details.status} /></div></div>
      </div>
      {onReview && (
        <div className="mt-5 flex justify-end border-t border-border/70 pt-4">
          <Button data-testid="button-review-request" onClick={onReview}>
            <Check className="mr-2 h-4 w-4" />
            Anfrage geprüft – Machbarkeit prüfen
          </Button>
        </div>
      )}

      {revision && (
        <div data-testid="revision-comparison" className="mt-5 rounded-xl border border-amber-600/25 bg-amber-500/10 p-4">
          <p className="font-semibold">{revision.kind === "SCHEDULE_CHANGE" ? "Terminänderung – Rückmeldung erforderlich" : "Neue Version der Leistungsanfrage"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {revision.kind === "SCHEDULE_CHANGE" ? "Neuer AG-Terminvorschlag" : "Bitte prüfen Sie die neue Version derselben Anfragekette."}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs text-muted-foreground">Bisheriger Zeitraum</p><p className="mt-1 font-medium">{revision.previousTimeWindow ? `${dateText(revision.previousTimeWindow.start)} – ${dateText(revision.previousTimeWindow.end)}` : "Nicht veröffentlicht"}</p></div>
            <div><p className="text-xs text-muted-foreground">Neuer Vorschlag</p><p className="mt-1 font-medium">{dateText(revision.proposedTimeWindow?.start)} – {dateText(revision.proposedTimeWindow?.end)}</p></div>
          </div>
          {revision.dayDelta && <p className="mt-3 text-xs text-muted-foreground">Verschiebung: Beginn {revision.dayDelta.startDays >= 0 ? "+" : ""}{revision.dayDelta.startDays} Tage, Ende {revision.dayDelta.endDays >= 0 ? "+" : ""}{revision.dayDelta.endDays} Tage.</p>}
          {revision.comment && <p className="mt-2 text-sm"><span className="font-medium">Änderungsgrund:</span> {revision.comment}</p>}
          {revision.history?.length > 1 && <div className="mt-3 border-t border-amber-700/15 pt-3"><p className="text-xs font-semibold text-muted-foreground">Revisionsverlauf</p><div className="mt-2 space-y-1 text-xs">{revision.history.map((item: any, index: number) => <p key={`${item.id}-${index}`}>{item.kind === "SCHEDULE_CHANGE" ? "Terminänderung" : `Version ${index + 1}`} · {dateText(item.start)} – {dateText(item.end)} · {STATUS_LABELS[item.status] ?? item.status}</p>)}</div></div>}
        </div>
      )}

      <details data-testid="secondary-request-details" className="group mt-5 border-t border-border/70 pt-4">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <span>Weitere Angaben anzeigen</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="mt-4 space-y-4 text-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-background/60 p-4">
              <p className="font-medium">Beschreibung und Arbeitsort</p>
              <p className="mt-2 text-muted-foreground">{description}</p>
              <p className="mt-3 flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{place}</p>
            </div>
            <div className="rounded-xl border border-border bg-background/60 p-4">
              <p className="font-medium">Puffer und Arbeitsbereich</p>
              <p className="mt-2 text-muted-foreground">
                {text(buffer.earliestStart, snap.earliestStart) === EMPTY && text(buffer.latestEnd, snap.latestEnd) === EMPTY
                  ? "Kein zusätzlicher Puffer veröffentlicht."
                  : `${dateText(text(buffer.earliestStart, snap.earliestStart))} – ${dateText(text(buffer.latestEnd, snap.latestEnd))}`}
              </p>
              <p className="mt-3 text-muted-foreground">Gewerk / Bereich: {text(snap.gewerk, snap.trade, details.takt.gewerk)} / {text(location.zone, snap.zone, details.takt.zone)}</p>
            </div>
          </div>
          <div className="rounded-xl border border-dashed border-border/80 p-4">
            <p className="font-medium">Vorgänger und Nachfolger</p>
            {dependencies.length === 0 ? <p className="mt-2 text-muted-foreground">Keine Vorgänger oder Nachfolger veröffentlicht.</p> : <div className="mt-2 flex flex-wrap gap-2">{dependencies.map((item, index) => <span key={`${item}-${index}`} className="rounded-lg bg-muted/60 px-3 py-1.5 text-xs">{item}</span>)}</div>}
          </div>
          {Object.keys(policy).length > 0 && (
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-4 w-4 text-primary" />Nutzungsrichtlinie</div>
              <p className="mt-2">{text(policy.name, policy.title)}</p>
              {typeof policy.purpose === "string" && <p className="mt-1 text-xs text-muted-foreground">{policy.purpose}</p>}
              {policyPermissions.length > 0 && <p className="mt-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">Erlaubt:</span> {policyPermissions.join(", ")}</p>}
              {policyProhibitions.length > 0 && <p className="mt-1 text-xs text-muted-foreground"><span className="font-medium text-foreground">Nicht erlaubt:</span> {policyProhibitions.join(", ")}</p>}
            </div>
          )}
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Datenherkunft: veröffentlichte Leistungsfreigabe, Version {details.leistungVersion ? `v${details.leistungVersion}` : EMPTY}.</p>
        </div>
      </details>
    </section>
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
    create.mutate({
      leistungsanfrageId: id,
      data: { resourceTypeId, requiredCapacity: Number(capacity), utilizationPercent: Number(utilization), requiredQualification: qualification || null, periodStart: periodStart || defaultStart, periodEnd: periodEnd || defaultEnd, notes: notes || null },
    }, {
      onSuccess: () => { toast({ title: "Ressourcenbedarf gespeichert" }); setShowAdd(false); setResourceTypeId(""); setCapacity(""); setQualification(""); setPeriodStart(""); setPeriodEnd(""); setNotes(""); refresh(); },
      onError: () => toast({ title: "Ressourcenbedarf konnte nicht gespeichert werden", variant: "destructive" }),
    });
  };
  const removeRow = (requirementId: string) => {
    if (!window.confirm("Ressourcenbedarf wirklich entfernen?")) return;
    remove.mutate({ leistungsanfrageId: id, reqId: requirementId }, { onSuccess: () => { toast({ title: "Ressourcenbedarf entfernt" }); refresh(); }, onError: () => toast({ title: "Ressourcenbedarf konnte nicht entfernt werden", variant: "destructive" }) });
  };

  return (
    <div data-testid="resource-block">
      {loadError && <p className="mb-3 rounded-lg border border-amber-600/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Ressourcenbedarf konnte nicht aktualisiert werden. Bereits veröffentlichte Angaben bleiben sichtbar.</p>}
      {requirements.length === 0
        ? <div className="rounded-xl border border-dashed border-border/80 p-4 text-sm text-muted-foreground">Noch kein Ressourcenbedarf erfasst. Ergänzen Sie nur den Bedarf, der für Ihre Rückmeldung relevant ist.</div>
        : <div className="space-y-2">{requirements.map((req) => <div data-testid={`resource-row-${req.id}`} key={req.id} className="flex items-start gap-3 rounded-xl border border-border bg-background/70 p-3"><Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="font-medium">{text(req.resourceTypeName, req.resourceTypeCode)}</p><p className="mt-1 text-xs text-muted-foreground">{String(req.requiredCapacity ?? EMPTY)} {req.capacityUnit ?? ""} · {req.utilizationPercent ? `${req.utilizationPercent}% Auslastung` : "Auslastung nicht veröffentlicht"} · {dateText(req.periodStart)} – {dateText(req.periodEnd)}</p>{req.requiredQualification && <p className="mt-1 text-xs text-muted-foreground">Qualifikation: {req.requiredQualification}</p>}{req.notes && <p className="mt-1 text-xs text-muted-foreground">{req.notes}</p>}</div>{canEdit && <Button data-testid={`button-delete-resource-${req.id}`} variant="ghost" size="icon" disabled={remove.isPending} onClick={() => removeRow(req.id)} aria-label="Ressourcenbedarf entfernen"><Trash2 className="h-4 w-4 text-muted-foreground" /></Button>}</div>)}</div>}
      {canEdit && (!showAdd
        ? <Button data-testid="button-add-resource" className="mt-4" variant="outline" size="sm" onClick={() => setShowAdd(true)}><Plus className="mr-2 h-4 w-4" />Bedarf ergänzen</Button>
        : <div className="mt-4 rounded-xl border border-border bg-muted/40 p-4">
          <div className="flex items-center justify-between"><p className="text-sm font-semibold">Ressourcenbedarf ergänzen</p><Button data-testid="button-close-resource" variant="ghost" size="icon" onClick={() => setShowAdd(false)}><X className="h-4 w-4" /></Button></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Label>Ressourcentyp</Label><Select value={resourceTypeId} onValueChange={setResourceTypeId}><SelectTrigger data-testid="select-resource-type" className="mt-1"><SelectValue placeholder="Typ auswählen" /></SelectTrigger><SelectContent>{typeQuery.data?.items.filter((item) => item.active).map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
            <div><Label htmlFor="resource-capacity">Kapazität</Label><Input data-testid="input-resource-capacity" id="resource-capacity" className="mt-1" type="number" min="0.01" step="0.01" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></div>
            <div><Label htmlFor="resource-utilization">Auslastung in Prozent</Label><Input data-testid="input-resource-utilization" id="resource-utilization" className="mt-1" type="number" min="1" max="100" value={utilization} onChange={(event) => setUtilization(event.target.value)} /></div>
            <div><Label htmlFor="resource-start">Von</Label><Input data-testid="input-resource-start" id="resource-start" className="mt-1" type="date" value={periodStart || defaultStart} onChange={(event) => setPeriodStart(event.target.value)} /></div>
            <div><Label htmlFor="resource-end">Bis</Label><Input data-testid="input-resource-end" id="resource-end" className="mt-1" type="date" value={periodEnd || defaultEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></div>
            <div className="sm:col-span-2"><Label htmlFor="resource-qualification">Qualifikation</Label><Input data-testid="input-resource-qualification" id="resource-qualification" className="mt-1" value={qualification} onChange={(event) => setQualification(event.target.value)} placeholder="Optional" /></div>
            <div className="sm:col-span-2"><Label htmlFor="resource-notes">Hinweis</Label><Textarea data-testid="input-resource-notes" id="resource-notes" className="mt-1" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optionaler Hinweis" /></div>
          </div>
          <Button data-testid="button-save-resource" className="mt-4" disabled={create.isPending} onClick={add}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}Bedarf speichern</Button>
        </div>)}
    </div>
  );
}

type ResponsePreset = {
  decision: "ACCEPTED" | "ALTERNATIVES_PROPOSED";
  alternatives?: Array<{ start: string; end: string }>;
};

type ScheduleProposal = {
  id: string;
  start: string;
  end: string;
  comment?: string | null;
  proposerRole?: "AG" | "AN";
};

function OwnScheduleChangeStart({
  requestId,
  currentAgreement,
  pending,
  onChanged,
}: {
  requestId: string;
  currentAgreement?: { start: string; end: string } | null;
  pending?: ScheduleProposal | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!start || !end || end < start || !reason.trim()) {
      toast({
        title: "Angaben fehlen",
        description: "Bitte geben Sie einen neuen Zeitraum und einen Grund an.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      await fetchJson(`/api/an/leistungsanfragen/${requestId}/change-proposals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start: `${start}T00:00:00.000Z`,
          end: `${end}T23:59:59.000Z`,
          comment: reason.trim(),
        }),
      });
      toast({ title: "Neuabstimmung gestartet" });
      setStart("");
      setEnd("");
      setReason("");
      onChanged();
    } catch (error) {
      toast({
        title: "Neuabstimmung konnte nicht gestartet werden",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-testid="own-schedule-change" className="rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <ArrowRightLeft className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-base font-semibold">Termin nicht mehr einhaltbar?</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Starten Sie eine Neuabstimmung. Der bisher bestätigte Zeitraum bleibt bestehen, bis beide Seiten einen neuen Zeitraum vereinbart haben.
          </p>
        </div>
      </div>
      {currentAgreement && (
        <p className="mt-3 rounded-lg bg-background/70 px-3 py-2 text-sm">
          Bestätigter Zeitraum: <span className="font-medium">{dateText(currentAgreement.start)} – {dateText(currentAgreement.end)}</span>
        </p>
      )}
      {pending ? (
        <p className="mt-3 text-sm font-medium text-primary">
          Ihr Änderungsvorschlag vom {dateText(pending.start)} – {dateText(pending.end)} wartet auf die Rückmeldung des Auftraggebers.
        </p>
      ) : (
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <div>
            <Label htmlFor="own-change-start">Neuer Beginn</Label>
            <Input id="own-change-start" data-testid="input-own-change-start" className="mt-1" type="date" value={start} onChange={(event) => setStart(event.target.value)} />
          </div>
          <div>
            <Label htmlFor="own-change-end">Neues Ende</Label>
            <Input id="own-change-end" data-testid="input-own-change-end" className="mt-1" type="date" value={end} onChange={(event) => setEnd(event.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="own-change-reason">Grund</Label>
            <Textarea id="own-change-reason" data-testid="input-own-change-reason" className="mt-1" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Warum kann der bestätigte Zeitraum nicht eingehalten werden?" maxLength={2000} />
          </div>
          <Button data-testid="button-start-own-schedule-change" className="sm:col-span-2" type="submit" disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Neuabstimmung starten
          </Button>
        </form>
      )}
    </section>
  );
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Aktion konnte nicht ausgeführt werden.");
  return body as T;
}

function ScheduleChangeResponse({ requestId, proposal, onChanged }: { requestId: string; proposal: ScheduleProposal; onChanged: () => void }) {
  const { toast } = useToast();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (action: "accept" | "reject" | "counter") => {
    if (action === "counter" && (!start || !end || end < start)) {
      toast({ title: "Zeitraum prüfen", description: "Beginn und Ende des Gegenvorschlags sind erforderlich.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const base = `/api/an/leistungsanfragen/${requestId}/change-proposals/${proposal.id}`;
      await fetchJson(action === "counter" ? `${base}/counter` : `${base}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "counter" ? JSON.stringify({ start: `${start}T00:00:00.000Z`, end: `${end}T23:59:59.000Z`, comment: comment || null }) : undefined,
      });
      toast({ title: action === "accept" ? "Terminänderung bestätigt" : action === "reject" ? "Terminänderung abgelehnt" : "Alternative gesendet" });
      onChanged();
    } catch (error) {
      toast({ title: "Terminänderung konnte nicht verarbeitet werden", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-testid="schedule-change-response" className="rounded-xl border border-amber-600/25 bg-amber-500/10 p-4">
      <h2 className="text-base font-semibold">Neuer Terminvorschlag</h2>
      <p className="mt-1 text-sm text-muted-foreground">Terminänderung – Rückmeldung erforderlich. Neuer AG-Terminvorschlag: {dateText(proposal.start)} – {dateText(proposal.end)}.</p>
      {proposal.comment && <p className="mt-2 text-sm">{proposal.comment}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void submit("accept")} disabled={busy}><CheckCircle2 className="mr-1.5 h-4 w-4" />Bestätigen</Button>
        <Button size="sm" variant="outline" onClick={() => void submit("reject")} disabled={busy}><X className="mr-1.5 h-4 w-4" />Nicht möglich</Button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div><Label htmlFor="schedule-counter-start">Neuer Beginn</Label><Input id="schedule-counter-start" aria-label="Neuer Beginn" className="mt-1" type="date" value={start} onChange={(event) => setStart(event.target.value)} /></div>
        <div><Label htmlFor="schedule-counter-end">Neues Ende</Label><Input id="schedule-counter-end" aria-label="Neues Ende" className="mt-1" type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></div>
        <Textarea className="sm:col-span-2" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Hinweis (optional)" />
        <Button className="sm:col-span-2" variant="secondary" onClick={() => void submit("counter")} disabled={busy}>Alternative vorschlagen</Button>
      </div>
    </section>
  );
}

function AvailabilitySection({ id, canRespond, latest, loadError, requestedStart, requestedEnd, onContinueWithoutCheck, onUseRecommendation }: {
  id: string;
  canRespond: boolean;
  latest: any;
  loadError?: boolean;
  requestedStart: string;
  requestedEnd: string;
  onContinueWithoutCheck: () => void;
  onUseRecommendation: (preset: ResponsePreset) => void;
}) {
  const { toast } = useToast();
  const client = useQueryClient();
  const run = useRunLeistungsanfrageAvailabilityCheck();
  const publicResult = latest?.publicResult;
  const result = latest?.result as string | undefined;
  const runCheck = () => run.mutate({ leistungsanfrageId: id }, { onSuccess: () => { toast({ title: "Verfügbarkeitsprüfung aktualisiert" }); void client.invalidateQueries({ queryKey: ["/api/an/leistungsanfragen", id, "availability-checks/latest"] }); }, onError: () => toast({ title: "Verfügbarkeitsprüfung konnte nicht gestartet werden", variant: "destructive" }) });
  const complete = latest?.status === "COMPLETED";
  const alternatives = Array.isArray(publicResult?.alternatives) ? publicResult.alternatives : [];
  const recommendation = result === "FEASIBLE"
    ? "Empfehlung für Phase 3: Termin bestätigen."
    : result === "FEASIBLE_WITH_ALTERNATIVES"
      ? "Empfehlung für Phase 3: Alternative vorschlagen."
      : result
        ? "Empfehlung für Phase 3: Nicht möglich oder Alternative vorschlagen."
        : "Empfehlung für Phase 3: Bedarf prüfen und danach eine Rückmeldung auswählen.";
  const resultLabel = result === "FEASIBLE" ? "Machbar" : result === "FEASIBLE_WITH_ALTERNATIVES" ? "Mit Alternativen machbar" : result ? "Im Zeitraum nicht machbar" : "Noch nicht geprüft";

  return (
    <div data-testid="availability-block">
      {loadError && <p className="mb-3 rounded-lg border border-amber-600/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">Das letzte Prüfergebnis konnte nicht geladen werden. Sie können die Prüfung erneut starten.</p>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${result === "FEASIBLE" ? "bg-emerald-600/10 text-emerald-700" : complete ? "bg-accent/30 text-primary" : "bg-muted text-muted-foreground"}`}>{complete ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}</div><div><p data-testid="availability-result" className="font-semibold">{resultLabel}</p><p className="mt-1 text-sm text-muted-foreground">Prüfzeitraum: {dateText(requestedStart)} – {dateText(requestedEnd)}. {complete ? "Das Ergebnis berücksichtigt den erfassten Ressourcenbedarf." : "Starten Sie die Prüfung, um eine belastbare Empfehlung für die Rückmeldung zu erhalten."}</p></div></div>
        <Button data-testid="button-run-availability" variant="outline" disabled={run.isPending || !canRespond} onClick={runCheck}>{run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}{complete ? "Erneut prüfen" : "Prüfung starten"}</Button>
      </div>
       <p data-testid="availability-recommendation" className="mt-4 rounded-xl border border-primary/15 bg-primary/5 px-4 py-3 text-sm font-medium text-primary">{recommendation}</p>
        {(canRespond || complete) && <div className="mt-4 flex flex-wrap gap-2">
         {!complete && <Button data-testid="button-continue-without-availability" variant="ghost" onClick={onContinueWithoutCheck}>Ohne automatische Prüfung fortfahren</Button>}
         {result === "FEASIBLE" && <Button data-testid="button-use-availability-recommendation" variant="outline" onClick={() => onUseRecommendation({ decision: "ACCEPTED" })}>Empfehlung übernehmen</Button>}
         {result === "FEASIBLE_WITH_ALTERNATIVES" && alternatives[0]?.timeWindow?.start && alternatives[0]?.timeWindow?.end && <Button data-testid="button-use-availability-recommendation" variant="outline" onClick={() => onUseRecommendation({ decision: "ALTERNATIVES_PROPOSED", alternatives: [{ start: String(alternatives[0].timeWindow.start).slice(0, 10), end: String(alternatives[0].timeWindow.end).slice(0, 10) }] })}>Empfehlung übernehmen</Button>}
       </div>}
       {alternatives.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Empfohlene Alternativfenster</p>{alternatives.map((item: any) => <div key={item.alternativeId} className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2 text-sm"><span>Priorität {item.rank}</span><span className="font-medium">{dateText(item.timeWindow?.start)} – {dateText(item.timeWindow?.end)}</span></div>)}</div>}
    </div>
  );
}

function ResponseForm({ id, canRespond, requestedStart, requestedEnd, preset }: { id: string; canRespond: boolean; requestedStart: string; requestedEnd: string; preset?: ResponsePreset | null }) {
  const { toast } = useToast();
  const client = useQueryClient();
  const submit = useSubmitLeistungsanfrageResponse();
  const [decision, setDecision] = useState<"" | "ACCEPTED" | "ALTERNATIVES_PROPOSED" | "REJECTED">("");
  const [alternatives, setAlternatives] = useState([{ start: "", end: "" }]);
  const [reasonCode, setReasonCode] = useState("");
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!preset) return;
    setDecision(preset.decision);
    if (preset.alternatives) setAlternatives(preset.alternatives);
  }, [preset]);
  const requestedStartDate = requestedStart.slice(0, 10);
  const requestedEndDate = requestedEnd.slice(0, 10);
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!decision) return;
    if (decision === "REJECTED" && !reasonCode) { toast({ title: "Grund auswählen", description: "Bitte wählen Sie einen allgemeinen Grund.", variant: "destructive" }); return; }
    if (decision === "ALTERNATIVES_PROPOSED" && alternatives.some((item) => !item.start || !item.end || item.end < item.start)) { toast({ title: "Alternativen prüfen", description: "Jede Alternative benötigt ein gültiges Zeitfenster.", variant: "destructive" }); return; }
    const payload: NuResponseCreate = { decision: decision as TaktDecision };
    if (decision === "ACCEPTED") payload.acceptedTimeWindow = { start: requestedStart, end: requestedEnd };
    if (decision === "ALTERNATIVES_PROPOSED") payload.alternatives = alternatives.map((item, index) => ({ alternativeId: `alternative-${index + 1}`, rank: index + 1, timeWindow: { start: `${item.start}T00:00:00.000Z`, end: `${item.end}T23:59:59.000Z` } }));
    if (decision === "REJECTED") payload.reasonCode = reasonCode as typeof TaktResponseReasonCode[keyof typeof TaktResponseReasonCode];
    if (comment.trim()) payload.comment = comment.trim();
    submit.mutate({ leistungsanfrageId: id, data: payload }, { onSuccess: () => { setSent(true); toast({ title: "Antwort gesendet" }); void client.invalidateQueries({ queryKey: getGetAnLeistungsanfrageDetailsQueryKey(id) }); }, onError: () => toast({ title: "Antwort konnte nicht gesendet werden", description: "Bitte prüfen Sie die Angaben und versuchen Sie es erneut.", variant: "destructive" }) });
  };
  if (sent || !canRespond) return <div data-testid="response-sent" className="rounded-xl border border-emerald-700/20 bg-emerald-600/10 p-4 text-sm text-emerald-900 dark:text-emerald-200"><p className="font-semibold">Antwort gesendet – Auftraggeber ist am Zug.</p><p className="mt-1 text-muted-foreground">Sie erhalten eine neue Aufgabe, sobald der Auftraggeber reagiert.</p></div>;

  return (
    <form data-testid="response-form" onSubmit={send} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <button aria-pressed={decision === "ACCEPTED" || preset?.decision === "ACCEPTED"} data-testid="button-decision-accepted" type="button" onClick={() => setDecision("ACCEPTED")} className={`rounded-xl border p-4 text-left text-sm ${decision === "ACCEPTED" || preset?.decision === "ACCEPTED" ? "border-emerald-600 bg-emerald-600/10" : "border-border hover:border-primary/40"}`}><CheckCircle2 className="mb-2 h-4 w-4 text-emerald-700" /><span className="font-semibold">Termin bestätigen</span><span className="mt-1 block text-xs text-muted-foreground">Angefragten Zeitraum übernehmen</span></button>
        <button aria-pressed={decision === "ALTERNATIVES_PROPOSED"} data-testid="button-decision-alternative" type="button" onClick={() => setDecision("ALTERNATIVES_PROPOSED")} className={`rounded-xl border p-4 text-left text-sm ${decision === "ALTERNATIVES_PROPOSED" ? "border-amber-600 bg-amber-500/10" : "border-border hover:border-primary/40"}`}><CalendarDays className="mb-2 h-4 w-4 text-amber-700" /><span className="font-semibold">Alternative vorschlagen</span><span className="mt-1 block text-xs text-muted-foreground">Neuen Zeitraum angeben</span></button>
        <button aria-pressed={decision === "REJECTED"} data-testid="button-decision-rejected" type="button" onClick={() => setDecision("REJECTED")} className={`rounded-xl border p-4 text-left text-sm ${decision === "REJECTED" ? "border-destructive bg-destructive/10" : "border-border hover:border-primary/40"}`}><X className="mb-2 h-4 w-4 text-destructive" /><span className="font-semibold">Nicht möglich</span><span className="mt-1 block text-xs text-muted-foreground">Allgemeinen Grund auswählen</span></button>
      </div>
      {decision === "ACCEPTED" && <div data-testid="accepted-window-summary" className="rounded-xl border border-emerald-700/20 bg-emerald-600/10 p-4 text-sm"><p className="font-semibold">Angefragter Zeitraum wird bestätigt</p><p className="mt-1">{dateText(requestedStart)} – {dateText(requestedEnd)}</p><p className="mt-1 text-xs text-muted-foreground">Eine erneute Eingabe ist nicht erforderlich.</p></div>}
      {decision === "ALTERNATIVES_PROPOSED" && <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4"><div className="flex items-center justify-between"><p className="text-sm font-semibold">Neuer Zeitraum</p>{alternatives.length < 3 && <Button data-testid="button-add-alternative" type="button" size="sm" variant="outline" onClick={() => setAlternatives([...alternatives, { start: "", end: "" }])}><Plus className="mr-1 h-3.5 w-3.5" />Weitere Alternative</Button>}</div>{alternatives.map((item, index) => <div key={index} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"><div><Label htmlFor={`alternative-start-${index}`}>Beginn {index + 1}</Label><Input data-testid={`input-alternative-start-${index}`} id={`alternative-start-${index}`} className="mt-1" type="date" value={item.start} onChange={(event) => setAlternatives(alternatives.map((row, rowIndex) => rowIndex === index ? { ...row, start: event.target.value } : row))} /></div><div><Label htmlFor={`alternative-end-${index}`}>Ende {index + 1}</Label><Input data-testid={`input-alternative-end-${index}`} id={`alternative-end-${index}`} className="mt-1" type="date" value={item.end} onChange={(event) => setAlternatives(alternatives.map((row, rowIndex) => rowIndex === index ? { ...row, end: event.target.value } : row))} /></div>{alternatives.length > 1 && <Button data-testid={`button-remove-alternative-${index}`} type="button" variant="ghost" size="icon" className="self-end" onClick={() => setAlternatives(alternatives.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button>}</div>)}</div>}
      {decision === "REJECTED" && <div className="rounded-xl border border-border bg-muted/40 p-4"><Label>Allgemeiner Grund</Label><Select value={reasonCode} onValueChange={setReasonCode}><SelectTrigger data-testid="select-reason-code" className="mt-1"><SelectValue placeholder="Grund auswählen" /></SelectTrigger><SelectContent><SelectItem value={TaktResponseReasonCode.RESOURCE_CONFLICT}>Ressourcenkonflikt</SelectItem><SelectItem value={TaktResponseReasonCode.NO_CAPACITY}>Keine Kapazität</SelectItem><SelectItem value={TaktResponseReasonCode.EQUIPMENT_UNAVAILABLE}>Gerät nicht verfügbar</SelectItem><SelectItem value={TaktResponseReasonCode.QUALIFICATION_MISSING}>Qualifikation fehlt</SelectItem><SelectItem value={TaktResponseReasonCode.TIME_WINDOW_TOO_SHORT}>Zeitraum zu kurz</SelectItem><SelectItem value={TaktResponseReasonCode.OUTSIDE_PLANNING_HORIZON}>Außerhalb des Planungshorizonts</SelectItem><SelectItem value={TaktResponseReasonCode.OTHER}>Sonstiger allgemeiner Grund</SelectItem></SelectContent></Select></div>}
      <div><Label htmlFor="response-comment">Hinweis <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea data-testid="input-response-comment" id="response-comment" className="mt-1" maxLength={2000} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Nur veröffentlichbare Hinweise" /></div>
      <div className="flex justify-end"><Button data-testid="button-submit-response" type="submit" disabled={submit.isPending || !decision}>{submit.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Rückmeldung senden</Button></div>
    </form>
  );
}

function TerminalNotice({ status }: { status: string }) {
  const copy: Record<string, [string, string]> = {
    RESPONDED: ["Antwort gesendet", "Antwort gesendet – Auftraggeber ist am Zug."],
    CONFIRMED: ["Leistung bestätigt", "Der Auftraggeber hat die Rückmeldung bestätigt. Diese Anfrage ist abgeschlossen."],
    CANCELLED: ["Anfrage beendet", "Der Auftraggeber hat diese Leistungsanfrage beendet. Es ist keine Aktion erforderlich."],
    SUPERSEDED: ["Anfrage ersetzt", "Diese Leistungsanfrage wurde durch eine neuere Anfrage ersetzt."],
    EXPIRED: ["Antwortfrist abgelaufen", "Die veröffentlichte Antwortfrist ist abgelaufen. Es ist keine reguläre Antwort mehr möglich."],
  };
  const [title, description] = copy[status] ?? ["Keine Aktion erforderlich", "Für diese Anfrage ist derzeit keine Antwortaktion möglich."];
  return <div data-testid="terminal-notice" className="flex items-start gap-3 rounded-2xl border border-border bg-muted/50 p-5"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" /><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p></div></div>;
}

export default function LeistungsanfrageDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const id = requestId ?? "";
  const [phaseOverride, setPhaseOverride] = useState<number | null>(null);
  const [responsePreset, setResponsePreset] = useState<ResponsePreset | null>(null);
  const detailQuery = useGetAnLeistungsanfrageDetails(id, { query: { enabled: !!id, queryKey: getGetAnLeistungsanfrageDetailsQueryKey(id) } });
  const coordinationQuery = useQuery({
    queryKey: ["/api/an/leistungsanfragen", id, "coordination"],
    enabled: !!id,
    queryFn: () => fetchJson<{
      openProposal?: ScheduleProposal | null;
      currentAgreement?: { start: string; end: string } | null;
    }>(`/api/an/leistungsanfragen/${id}/coordination`),
  });
  const requirementQuery = useListLeistungsanfrageResourceRequirements(id, { query: { enabled: !!id, queryKey: getListLeistungsanfrageResourceRequirementsQueryKey(id) } });
  const availabilityQuery = useQuery({
    queryKey: ["/api/an/leistungsanfragen", id, "availability-checks/latest"],
    enabled: !!id,
    queryFn: () => fetchJson<any>(`/api/an/leistungsanfragen/${id}/availability-checks/latest`),
  });
  const details = detailQuery.data;
  if (detailQuery.isLoading) return <main className="mx-auto max-w-7xl space-y-6 p-5 lg:p-8"><Skeleton className="h-8 w-32" /><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></main>;
  if (detailQuery.isError || !details) return <main className="mx-auto flex min-h-[60dvh] max-w-lg flex-col items-center justify-center gap-4 p-6 text-center"><AlertTriangle className="h-10 w-10 text-destructive" /><h1 className="text-lg font-semibold">Leistungsanfrage nicht verfügbar</h1><p className="text-sm text-muted-foreground">Die Anfrage konnte nicht geöffnet werden oder ist nicht mehr verfügbar.</p><div className="flex gap-2"><Button data-testid="button-back-error" variant="outline" onClick={() => setLocation("/leistungsanfragen")}><ArrowLeft className="mr-2 h-4 w-4" />Zur Inbox</Button><Button data-testid="button-retry-detail" variant="secondary" onClick={() => void detailQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Erneut laden</Button></div></main>;

  const snap = object(details.snapshotPayload);
  const window = object(snap.plannedTimeWindow ?? snap.timeWindow ?? snap.zeitfenster);
  const requestedStart = typeof window.start === "string" ? window.start : details.plannedStart;
  const requestedEnd = typeof window.end === "string" ? window.end : details.plannedEnd;
  const defaultStart = requestedStart.slice(0, 10);
  const defaultEnd = requestedEnd.slice(0, 10);
  const requirements = (requirementQuery.data ?? details.resourceRequirements) as AnLeistungsanfrageResourceRequirement[];
  const hasAgreement = details.status === "CONFIRMED";
  const terminal = ["RESPONDED", "CANCELLED", "SUPERSEDED", "EXPIRED"].includes(details.status) && !hasAgreement;
  const policyDetailsAvailable = (details as AnLeistungsanfrageDetails & { policyDetailsAvailable?: boolean }).policyDetailsAvailable !== false;
  const canRespond = policyDetailsAvailable && !terminal && ["RECEIVED", "DETAILS_RETRIEVED", "UNDER_REVIEW", "REVISION_REQUIRED"].includes(details.status);
  const scheduleProposal = coordinationQuery.data?.openProposal?.proposerRole === "AG"
    ? coordinationQuery.data.openProposal
    : null;
  const ownScheduleProposal = coordinationQuery.data?.openProposal?.proposerRole === "AN"
    ? coordinationQuery.data.openProposal
    : null;
  const effectiveResponsePreset = responsePreset ?? (
    phaseOverride === 3 && availabilityQuery.data?.result === "FEASIBLE"
      ? { decision: "ACCEPTED" as const }
      : null
  );
  const derivedPhase = terminal ? 3 : !details.detailsRetrievedAt ? 1 : availabilityQuery.data?.status === "COMPLETED" ? 3 : 2;
  const phase = phaseOverride ?? derivedPhase;
  const reviewDetails = async () => {
    try {
      await fetchJson(`/api/an/leistungsanfragen/${id}/details/review`, { method: "POST" });
      setPhaseOverride(2);
      await detailQuery.refetch();
    } catch {
      // Keep phase 1 open when the explicit acknowledgement cannot be saved.
    }
  };
  const useRecommendation = (preset: ResponsePreset) => {
    setResponsePreset(preset);
    setPhaseOverride(3);
  };
  const phaseHeading = (number: number) => number === 1 ? "Anfrage prüfen" : number === 2 ? "Machbarkeit prüfen" : "Rückmeldung senden";
  const phaseDescription = (number: number) => number === 1
    ? "Leistung und Zeitraum prüfen."
    : number === 2
      ? "Ressourcenbedarf und Verfügbarkeit bewerten."
      : "Termin bestätigen, Alternative vorschlagen oder absagen.";
  const phasePreview = (number: number) => <div data-testid={`phase-${number}-preview`} className="rounded-xl border border-border bg-muted/30 px-4 py-3"><p className="text-xs text-muted-foreground">Phase {number}</p><p className="mt-1 text-sm font-semibold">{phaseHeading(number)}</p><p className="mt-1 text-xs text-muted-foreground">{phaseDescription(number)}</p></div>;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-5 pb-12 lg:p-8">
      <Button data-testid="button-back-inbox" variant="ghost" className="-ml-3 gap-2 text-muted-foreground" onClick={() => setLocation("/leistungsanfragen")}><ArrowLeft className="h-4 w-4" />Zurück zu Anfragen</Button>
       <header className="flex flex-col gap-5 border-b border-border/70 pb-6 md:flex-row md:items-start md:justify-between"><div><div className="flex flex-wrap items-center gap-3"><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary">LEISTUNGSANFRAGE / {details.requestNumber}</p><StatusBadge status={details.status} /></div><h1 data-testid="text-detail-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{phaseHeading(phase)}</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Nur der nächste erforderliche Schritt ist geöffnet. Abgeschlossene Angaben bleiben als Kontext verfügbar.</p></div><div className="rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm shadow-sm"><p className="text-[11px] text-muted-foreground">Aktuelle Phase</p><p data-testid="current-phase" className="mt-1 font-semibold">{phase} · {phaseHeading(phase)}</p></div></header>
       <PolicyDecisionPanel details={details} onChanged={() => void detailQuery.refetch()} />

      <div data-testid="phase-progress" className="grid gap-2 md:grid-cols-3">{[1, 2, 3].map((number) => <div key={number} className={`rounded-xl border px-4 py-3 ${phase === number ? "border-primary/40 bg-primary/5" : phase > number ? "border-emerald-700/20 bg-emerald-600/5" : "border-border bg-card"}`}><p className="text-xs text-muted-foreground">Phase {number}</p><p className="mt-1 text-sm font-semibold">{phaseHeading(number)}</p></div>)}</div>
       {phase > 1 ? <details data-testid="phase-1" className="group rounded-xl border border-border bg-card p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><span><span className="block text-xs text-muted-foreground">Phase 1 · abgeschlossen</span><span className="mt-1 block text-sm font-semibold">Anfrage prüfen</span></span><ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary><div className="mt-4"><RequestOverview details={details} requestedStart={requestedStart} requestedEnd={requestedEnd} /></div></details> : <section data-testid="phase-1" className="space-y-3"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-primary">Phase 1</p><h2 className="mt-1 text-xl font-semibold">Anfrage prüfen</h2><p className="mt-1 text-sm text-muted-foreground">Prüfen Sie die veröffentlichte Leistung und schließen Sie diese Phase bewusst ab.</p></div><RequestOverview details={details} requestedStart={requestedStart} requestedEnd={requestedEnd} onReview={policyDetailsAvailable && details.status === "RECEIVED" ? () => void reviewDetails() : undefined} /></section>}

      {phase === 1 ? <div className="space-y-3">{phasePreview(2)}{phasePreview(3)}</div> : phase > 2 ? <details data-testid="phase-2" className="group rounded-xl border border-border bg-card p-4"><summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden"><span><span className="block text-xs text-muted-foreground">Phase 2 · abgeschlossen</span><span className="mt-1 block text-sm font-semibold">Machbarkeit prüfen</span></span><ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary><div className="mt-4 grid gap-5 rounded-2xl border border-border bg-card p-5 lg:grid-cols-2"><div><h3 className="mb-4 flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-primary" />Ressourcenbedarf</h3><ResourceSection id={id} requirements={requirements} canEdit={false} defaultStart={defaultStart} defaultEnd={defaultEnd} loadError={requirementQuery.isError} /></div><div className="border-t border-border/70 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"><h3 className="mb-4 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4 text-primary" />Verfügbarkeit</h3><AvailabilitySection id={id} canRespond={false} latest={availabilityQuery.data} loadError={availabilityQuery.isError} requestedStart={requestedStart} requestedEnd={requestedEnd} onContinueWithoutCheck={() => undefined} onUseRecommendation={useRecommendation} /></div></div></details> : <section data-testid="phase-2" className="space-y-3"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Phase 2</p><h2 className="mt-1 text-xl font-semibold">Machbarkeit prüfen</h2><p className="mt-1 text-sm text-muted-foreground">Ressourcenbedarf und Verfügbarkeit gehören für den angefragten Zeitraum in einen gemeinsamen Prüfschritt.</p></div><div className="grid gap-5 rounded-2xl border border-border bg-card p-5 shadow-sm lg:grid-cols-2 lg:p-6"><div><h3 className="mb-4 flex items-center gap-2 font-semibold"><Users className="h-4 w-4 text-primary" />Ressourcenbedarf</h3><ResourceSection id={id} requirements={requirements} canEdit={canRespond} defaultStart={defaultStart} defaultEnd={defaultEnd} loadError={requirementQuery.isError} /></div><div className="border-t border-border/70 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"><h3 className="mb-4 flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4 text-primary" />Verfügbarkeit</h3><AvailabilitySection id={id} canRespond={canRespond} latest={availabilityQuery.data} loadError={availabilityQuery.isError} requestedStart={requestedStart} requestedEnd={requestedEnd} onContinueWithoutCheck={() => setPhaseOverride(3)} onUseRecommendation={useRecommendation} /></div></div></section>}

      {phase < 3 ? phasePreview(3) : <section data-testid="phase-3" className="space-y-3"><div><p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">Phase 3</p><h2 className="mt-1 text-xl font-semibold">{hasAgreement ? "Koordination" : "Rückmeldung senden"}</h2><p className="mt-1 text-sm text-muted-foreground">{hasAgreement ? "Bestätigte Leistungen können nur über eine bilaterale Neuabstimmung geändert werden." : "Termin bestätigen, Alternative vorschlagen oder Nicht-Machbarkeit melden."}</p></div><div className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">{terminal ? <TerminalNotice status={details.status} /> : scheduleProposal ? <ScheduleChangeResponse requestId={id} proposal={scheduleProposal} onChanged={() => { void coordinationQuery.refetch(); void detailQuery.refetch(); }} /> : hasAgreement ? <OwnScheduleChangeStart requestId={id} currentAgreement={coordinationQuery.data?.currentAgreement} pending={ownScheduleProposal} onChanged={() => { void coordinationQuery.refetch(); void detailQuery.refetch(); }} /> : <ResponseForm key={effectiveResponsePreset?.decision ?? "manual"} id={id} canRespond={canRespond} requestedStart={requestedStart} requestedEnd={requestedEnd} preset={effectiveResponsePreset} />}</div></section>}
    </main>
  );
}