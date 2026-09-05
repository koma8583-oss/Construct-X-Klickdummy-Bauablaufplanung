/** Compatibility export name for the normal Leistungsfreigabe dialog.
 * DataOffer/DataPublication packages deliberately have a separate workflow. */
import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCreateTaktRequestBatchWithSnapshot, useSendTaktRequest, type Takt } from "@workspace/api-client-react";
import { ChevronLeft, ChevronRight, ClipboardList, Lock, Send } from "lucide-react";

type Purpose = "RAHMENTERMINE" | "LEISTUNGSKOORDINATION" | "AUSFUEHRUNGSINFORMATIONEN" | "INDIVIDUELLE_FREIGABE";
type PolicyDelta = "WITHIN_BASELINE" | "REQUIRES_CONSENT" | "NOT_PERMITTED";
type PreviewItem = { taktId: string; deltaClass: PolicyDelta; error?: string; diff?: { changed?: string[]; summary?: string[] } };
type SendResult = { taktId: string; name: string; status: "SENT" | "FAILED"; error?: string };
const PURPOSES: Array<{ value: Purpose; label: string; description: string }> = [
  { value: "RAHMENTERMINE", label: "Rahmentermine", description: "Zeitfenster, Bereich und relevante Abhängigkeiten." },
  { value: "LEISTUNGSKOORDINATION", label: "Leistungskoordination", description: "Für die Abstimmung der konkreten Leistung." },
  { value: "AUSFUEHRUNGSINFORMATIONEN", label: "Ausführungsinformationen", description: "Für die Ausführung erforderliche Leistungsangaben." },
  { value: "INDIVIDUELLE_FREIGABE", label: "Individuelle Freigabe", description: "Erweiterte, aber weiterhin sichere Leistungsfreigabe." },
];
const FIELDS: Record<Purpose, string[]> = {
  RAHMENTERMINE: ["kurzbezeichnung", "workPackage", "trade", "plannedTimeWindow", "bufferTimeWindow", "location", "predecessors", "successors"],
  LEISTUNGSKOORDINATION: ["kurzbezeichnung", "workPackage", "trade", "plannedTimeWindow", "bufferTimeWindow", "location", "requiredOutput", "resourceRequirements", "constraints", "predecessors", "successors", "documentReferences"],
  AUSFUEHRUNGSINFORMATIONEN: ["kurzbezeichnung", "workPackage", "trade", "plannedTimeWindow", "bufferTimeWindow", "location", "requiredOutput", "constraints", "predecessors", "successors", "documentReferences"],
  INDIVIDUELLE_FREIGABE: ["kurzbezeichnung", "workPackage", "trade", "plannedTimeWindow", "bufferTimeWindow", "location", "requiredOutput", "resourceRequirements", "constraints", "predecessors", "successors", "documentReferences"],
};
const LABELS: Record<string, string> = {
  kurzbezeichnung: "Leistungsname", workPackage: "Leistungsbeschreibung", trade: "Gewerk", plannedTimeWindow: "Geplanter Zeitraum",
  bufferTimeWindow: "Frühester/spätester Zeitraum und Puffer", location: "Ausführungsbereich", predecessors: "Vorgänger",
  successors: "Nachfolger", requiredOutput: "Ausführungsangaben", resourceRequirements: "Benötigte Ressourcen",
  constraints: "Vorgaben", documentReferences: "Dokumentreferenzen",
};
interface ContractorOption {
  id: string; name: string; orgId: string; assignmentStatus: string; trade?: string | null;
  projectAgreementPolicyId?: string | null; projectAgreementStatus?: string | null;
  parentAgreement?: {
    id: string;
    lifecycleStatus?: string;
    effectivePolicy?: Record<string, unknown> | null;
  } | null;
}
function inheritedPolicyContext(agreement: ContractorOption["parentAgreement"]): string[] {
  const policy = agreement?.effectivePolicy;
  if (!policy) return [];
  const labels: Array<[string, string]> = [
    ["projectReference", "Projektreferenz"],
    ["allowedPurposes", "Zulässige Zwecke"],
    ["allowedFieldScope", "Zulässiger Feldumfang"],
    ["validFrom", "Gültig ab"],
    ["validUntil", "Gültig bis"],
    ["retentionUntil", "Aufbewahrung bis"],
  ];
  return labels.flatMap(([key, label]) => {
    const value = policy[key];
    if (value === null || value === undefined || value === "") return [];
    return [`${label}: ${Array.isArray(value) ? value.join(", ") : String(value)}`];
  });
}
interface Props {
  open: boolean; onOpenChange: (open: boolean) => void; projectId: string; projectName: string;
  contractors: ContractorOption[]; takte?: Takt[]; initialRecipientIds?: string[];
  /** retained solely so old callers compile; drafts belong to the DataOffer flow. */
  draftPublication?: unknown;
}
const STEPS = ["AN auswählen", "Zweck wählen", "Leistungen auswählen", "Angaben festlegen", "Prüfen und senden"];

export function DataPublicationWizard({ open, onOpenChange, projectId, contractors, takte = [] }: Props) {
  const { toast } = useToast();
  const createBatch = useCreateTaktRequestBatchWithSnapshot();
  const send = useSendTaktRequest();
  const [step, setStep] = useState(0);
  const [recipient, setRecipient] = useState("");
  const [purpose, setPurpose] = useState<Purpose | "">("");
  const [leistungen, setLeistungen] = useState<Set<string>>(new Set());
  const [fields, setFields] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewItem[]>([]);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sendResults, setSendResults] = useState<SendResult[]>([]);
  const active = contractors.filter((item) => item.assignmentStatus === "ACTIVE" && item.projectAgreementStatus === "ACCEPTED" && item.projectAgreementPolicyId && item.parentAgreement?.effectivePolicy);
  const chosen = active.find((item) => item.orgId === recipient);
  const inheritedContext = inheritedPolicyContext(chosen?.parentAgreement);
  const allowed = purpose ? FIELDS[purpose] : [];
  const selectable = useMemo(() => takte.filter((item) => item.status !== "STORNIERT" && item.lifecycleStatus !== "CANCELLED"), [takte]);
  useEffect(() => { if (!open) return; setStep(0); setRecipient(""); setPurpose(""); setLeistungen(new Set()); setFields(new Set()); setPreview([]); setSubmitting(false); setSendResults([]); }, [open]);
  useEffect(() => { if (purpose) setFields(new Set(FIELDS[purpose])); }, [purpose]);
  const valid = step === 0 ? !!chosen : step === 1 ? !!purpose : step === 2 ? leistungen.size > 0 : step === 3 ? fields.size > 0 : true;
  const toggle = (field: string) => setFields((previous) => { const next = new Set(previous); next.has(field) ? next.delete(field) : next.add(field); return next; });
  const previewPolicy = async () => {
    if (!purpose || !chosen) return false;
    setPreviewing(true);
    try {
      const response = await fetch("/api/leistungsanfragen/policy-preview", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taktIds: [...leistungen], nuOrgId: chosen.orgId, purpose, selectedFields: [...fields] }),
      });
      const body = await response.json().catch(() => ({})) as { items?: PreviewItem[]; error?: string };
      if (!response.ok || !Array.isArray(body.items)) throw new Error(body.error || "Policy-Vorschau konnte nicht erstellt werden.");
      setPreview(body.items);
      return true;
    } catch (error) {
      toast({ title: "Policy-Vorschau konnte nicht erstellt werden", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
      return false;
    } finally {
      setPreviewing(false);
    }
  };
  const next = async () => {
    if (step === 3) {
      if (await previewPolicy()) setStep(4);
      return;
    }
    setStep(step + 1);
  };
  const submit = async () => {
    if (!purpose || !chosen || submitting) return;
    if (preview.some((item) => item.deltaClass === "NOT_PERMITTED") || preview.length !== leistungen.size) return;
    const previousResults = new Map(sendResults.map((item) => [item.taktId, item]));
    const taktIds = sendResults.length
      ? sendResults.filter((item) => item.status === "FAILED").map((item) => item.taktId)
      : [...leistungen];
    if (!taktIds.length) return;
    const byId = new Map(selectable.map((item) => [item.id, item.kurzbezeichnung || item.taktBezeichnung]));
    setSubmitting(true);
    try {
      const outcomes = await Promise.all(taktIds.map(async (taktId): Promise<SendResult> => {
        try {
          const batch = await createBatch.mutateAsync({ data: { taktId, nuOrgIds: [chosen.orgId], purpose, selectedFields: [...fields] } });
          const requests = batch.requests ?? [];
          if (requests.length !== 1) throw new Error("Die Erstellung lieferte kein eindeutiges Ergebnis.");
          await send.mutateAsync({ requestId: requests[0].id });
          return { taktId, name: byId.get(taktId) ?? taktId, status: "SENT" };
        } catch (error) {
          return { taktId, name: byId.get(taktId) ?? taktId, status: "FAILED", error: error instanceof Error ? error.message : "Unbekannter Fehler" };
        }
      }));
      outcomes.forEach((outcome) => previousResults.set(outcome.taktId, outcome));
      const results = [...leistungen].map((taktId) => previousResults.get(taktId)).filter((item): item is SendResult => !!item);
      setSendResults(results);
      const failed = results.filter((outcome) => outcome.status === "FAILED");
      toast(failed.length ? { title: `${failed.length} von ${results.length} Leistungsfreigaben fehlgeschlagen`, variant: "destructive" } : { title: "Leistungen für AN freigegeben" });
    } finally {
      setSubmitting(false);
    }
  };
  const pending = createBatch.isPending || send.isPending || previewing || submitting;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-2xl">
    <DialogHeader><DialogTitle className="flex items-center gap-2"><ClipboardList className="h-5 w-5 text-primary" />Leistungen für AN freigeben</DialogTitle>
      <p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">Wählen Sie einen aktiven AN, den Zweck und nur die für die Leistungen erforderlichen Angaben. Datenangebote für BIM-, Logistik- oder Dokumentpakete werden separat verwaltet.</p>
    </DialogHeader>
    <div className="flex gap-1">{STEPS.map((label, index) => <div key={label} className={`flex-1 text-center text-xs ${index === step ? "font-semibold text-primary" : "text-muted-foreground"}`}>{index + 1}. {label}</div>)}</div>
    <div className="min-h-[300px] py-3">
      {step === 0 && <div className="space-y-3"><p className="text-sm text-muted-foreground">Wählen Sie genau einen aktiven AN. Die gültige Projektvereinbarung wird automatisch verwendet.</p>{active.map((item) => <button type="button" key={item.orgId} onClick={() => setRecipient(item.orgId)} className={`w-full rounded-lg border p-3 text-left ${recipient === item.orgId ? "border-primary bg-primary/5" : ""}`}><p className="font-medium">{item.name}</p><p className="text-xs text-muted-foreground">Aktive Mitgliedschaft · Projektvereinbarung akzeptiert</p></button>)}{chosen && <div data-testid="parent-agreement" className="rounded-lg border bg-muted/30 p-3 text-sm"><b>Projektvereinbarung</b><br />Akzeptiert · {chosen.parentAgreement?.id}<div className="mt-2 flex flex-wrap gap-1">{inheritedContext.map((value) => <Badge key={value} variant="secondary">{value}</Badge>)}</div></div>}{!active.length && <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">Kein AN mit akzeptierter Projektvereinbarung verfügbar.</p>}</div>}
      {step === 1 && <div className="space-y-3"><p className="text-sm">Wählen Sie den geschäftlichen Zweck, keine technische Richtlinienvorlage.</p><Select value={purpose} onValueChange={(value) => setPurpose(value as Purpose)}><SelectTrigger><SelectValue placeholder="Zweck wählen…" /></SelectTrigger><SelectContent>{PURPOSES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>{purpose && <p className="text-sm text-muted-foreground">{PURPOSES.find((item) => item.value === purpose)?.description}</p>}</div>}
      {step === 2 && <div className="space-y-2"><p className="text-sm">Wählen Sie eine oder mehrere Leistungen.</p>{selectable.map((item) => <label key={item.id} className="flex gap-3 rounded-lg border p-3"><Checkbox checked={leistungen.has(item.id)} onCheckedChange={() => setLeistungen((previous) => { const next = new Set(previous); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })} /><span>{item.kurzbezeichnung || item.taktBezeichnung}</span></label>)}</div>}
      {step === 3 && <div className="space-y-3"><div data-testid="inherited-policy-context" className="rounded-lg border bg-muted/30 p-3 text-sm"><b>Aus akzeptierter Projektvereinbarung übernommen</b><p className="mt-1 text-xs text-muted-foreground">Dieser Kontext ist schreibgeschützt und wird nicht als Leistungsdatenfeld dupliziert.</p><div className="mt-2 flex flex-wrap gap-1">{inheritedContext.map((field) => <Badge key={field} variant="secondary">{field}</Badge>)}</div></div><p className="text-sm">Zusätzliche Angaben für {PURPOSES.find((item) => item.value === purpose)?.label}</p>{allowed.map((field) => <label className="flex gap-2 text-sm" key={field}><Checkbox checked={fields.has(field)} onCheckedChange={() => toggle(field)} />{LABELS[field]}</label>)}</div>}
      {step === 4 && <div className="space-y-3 rounded-lg border p-4 text-sm"><p><b>AN:</b> {chosen?.name}</p><p><b>Zweck:</b> {PURPOSES.find((item) => item.value === purpose)?.label}</p><p><b>Leistungen:</b> {leistungen.size}</p><p><b>Zusätzliche Angaben:</b> {[...fields].map((field) => LABELS[field]).join(", ")}</p><div data-testid="policy-preview" className="space-y-2 border-t pt-3"><b>Policy-Prüfung vor Versand</b>{preview.map((item) => <div key={item.taktId} className={`rounded border p-2 ${item.deltaClass === "NOT_PERMITTED" ? "border-destructive/40 bg-destructive/5" : item.deltaClass === "REQUIRES_CONSENT" ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-600/30 bg-emerald-600/5"}`}><span className="font-medium">{selectable.find((leistung) => leistung.id === item.taktId)?.kurzbezeichnung ?? item.taktId}: {item.deltaClass}</span>{item.diff?.summary?.map((summary) => <p key={summary} className="mt-1 text-xs text-muted-foreground">{summary}</p>)}{item.error && <p className="mt-1 text-xs text-destructive">{item.error}</p>}</div>)}</div>{sendResults.length > 0 && <div data-testid="batch-send-results" className="space-y-2 border-t pt-3"><b>Versandergebnis</b>{sendResults.map((item) => <p key={item.taktId} className={item.status === "SENT" ? "text-emerald-700" : "text-destructive"}>{item.name}: {item.status === "SENT" ? "gesendet" : `fehlgeschlagen – ${item.error}`}</p>)}</div>}<p className="flex gap-2 text-muted-foreground"><Lock className="h-4 w-4" />Projektangaben bleiben durch die Projektvereinbarung abgedeckt.</p></div>}
    </div>
    <DialogFooter className="flex !flex-row justify-between"><Button variant="outline" disabled={pending} onClick={() => step ? setStep(step - 1) : onOpenChange(false)}>{step ? <><ChevronLeft className="mr-1 h-4 w-4" />Zurück</> : "Abbrechen"}</Button>{step < 4 ? <Button disabled={!valid || pending} onClick={() => void next()}>{previewing ? "Wird geprüft…" : <>Weiter <ChevronRight className="ml-1 h-4 w-4" /></>}</Button> : <Button disabled={pending || preview.some((item) => item.deltaClass === "NOT_PERMITTED") || preview.length !== leistungen.size || (sendResults.length > 0 && !sendResults.some((item) => item.status === "FAILED"))} onClick={() => void submit()}>{pending ? "Wird gesendet…" : sendResults.some((item) => item.status === "FAILED") ? <><Send className="mr-1 h-4 w-4" />Fehlgeschlagene erneut senden</> : <><Send className="mr-1 h-4 w-4" />Senden</>}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}