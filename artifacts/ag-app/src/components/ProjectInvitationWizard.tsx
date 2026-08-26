import React, { useEffect, useMemo, useState } from "react";
import {
  useCreateProjectInvitationPackage,
  useGetPolicyTemplates,
  FIELD_GROUPS,
  FIELD_LABELS,
  FIELD_WHITELISTS,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DatePicker } from "@/components/date-picker";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ChevronLeft, ChevronRight, Eye, Lock, Search, Send, ShieldCheck, Users } from "lucide-react";

type Participant = {
  id: string;
  participantId: string;
  name: string;
  identityStatus?: string;
  connectorStatus?: string;
  membershipStatus?: string | null;
  selectable?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  participants: Participant[];
  onInvitationSent?: () => void;
};

const PRODUCT_TYPE = "TAKT_INFORMATION_PACKAGE";
const ALL_FIELDS = FIELD_WHITELISTS[PRODUCT_TYPE];
const STEP_LABELS = ["Teilnehmer", "Policy", "Datenfelder", "Übersicht"];

function buildInvitationOdrl(policyCode: string): Record<string, unknown> {
  return {
    "@context": "http://www.w3.org/ns/odrl.jsonld",
    "@type": "Set",
    uid: "urn:odrl:data-publication:project-invitation-preview",
    permission: [{
      target: "data-publication:project-invitation-preview",
      assigner: "organization:<ag-org-id>",
      assignee: "organization:<nu-org-id>",
      action: "use",
      constraint: [
        { leftOperand: "purpose", operator: "eq", rightOperand: policyCode === "SCHEDULE_COORDINATION" ? "scheduleCoordination" : policyCode },
        { leftOperand: "taktkoord:scope", operator: "eq", rightOperand: "taktkoord:projectSpecific" },
        { leftOperand: "taktkoord:internalUse", operator: "eq", rightOperand: "taktkoord:restrictedToRecipient" },
      ],
      duty: [{
        action: "delete",
        constraint: [{ leftOperand: "taktkoord:trigger", operator: "eq", rightOperand: "taktkoord:noLongerNeeded" }],
      }],
    }],
    prohibition: [
      { target: "data-publication:project-invitation-preview", action: "distribute" },
    ],
  };
}

export function ProjectInvitationWizard({
  open,
  onOpenChange,
  projectId,
  projectName,
  participants,
  onInvitationSent,
}: Props) {
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [selectedParticipants, setSelectedParticipants] = useState<Set<string>>(new Set());
  const [participantSearch, setParticipantSearch] = useState("");
  const [policyTemplateId, setPolicyTemplateId] = useState("");
  const [policyTemplateVersion, setPolicyTemplateVersion] = useState<number | undefined>();
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(ALL_FIELDS));
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [invitationMessage, setInvitationMessage] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [policyViewOpen, setPolicyViewOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const { data: policies } = useGetPolicyTemplates();
  const createPackage = useCreateProjectInvitationPackage();

  const selectableParticipants = participants.filter((participant) => participant.selectable);
  const filteredParticipants = useMemo(() => {
    const normalizedSearch = participantSearch.trim().toLocaleLowerCase();
    if (!normalizedSearch) return selectableParticipants;
    return selectableParticipants.filter((participant) =>
      [participant.name, participant.participantId]
        .some((value) => value.toLocaleLowerCase().includes(normalizedSearch)),
    );
  }, [participantSearch, selectableParticipants]);
  const invitationPolicies = useMemo(
    () => (policies ?? []).filter((policy) => policy.code === "SCHEDULE_COORDINATION"),
    [policies],
  );
  const selectedPolicy = invitationPolicies[0];
  useEffect(() => {
    if (selectedPolicy && policyTemplateId !== selectedPolicy.id) {
      setPolicyTemplateId(selectedPolicy.id);
    }
    if (selectedPolicy && policyTemplateVersion === undefined) {
      setPolicyTemplateVersion(selectedPolicy.templateVersion);
    }
  }, [selectedPolicy, policyTemplateId, policyTemplateVersion]);
  const autoTitle = useMemo(
    () => `Projekteinladung & Informationspaket – ${projectName}`,
    [projectName],
  );

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep(0);
      setSelectedParticipants(new Set());
       setParticipantSearch("");
      setPolicyTemplateId("");
      setPolicyTemplateVersion(undefined);
      setSelectedFields(new Set(ALL_FIELDS));
      setTitle("");
      setDescription("");
      setInvitationMessage("");
      setValidFrom("");
      setValidUntil("");
      setIdempotencyKey(crypto.randomUUID());
    }
    onOpenChange(nextOpen);
  };

  const toggleParticipant = (participantId: string) => {
    setSelectedParticipants((previous) => {
      const next = new Set(previous);
      next.has(participantId) ? next.delete(participantId) : next.add(participantId);
      return next;
    });
  };
  const toggleField = (field: string) => {
    setSelectedFields((previous) => {
      const next = new Set(previous);
      next.has(field) ? next.delete(field) : next.add(field);
      return next;
    });
  };
  const canContinue = [
    selectedParticipants.size > 0,
    Boolean(policyTemplateId),
    selectedFields.size > 0,
    true,
  ][step];

  const send = async () => {
    try {
      await createPackage.mutateAsync({
        projectId,
        data: {
          participantIds: Array.from(selectedParticipants),
          policyTemplateId,
          ...(policyTemplateVersion ? { policyTemplateVersion } : {}),
          selectedFields: Array.from(selectedFields),
          title: title.trim() || autoTitle,
          description: description.trim() || undefined,
          invitationMessage: invitationMessage.trim() || undefined,
          validFrom: validFrom ? `${validFrom}T00:00:00Z` : undefined,
          validUntil: validUntil ? `${validUntil}T23:59:59Z` : undefined,
          idempotencyKey,
        },
      });
      toast({
        title: "Einladung und Datenfreigabe vorbereitet",
        description: "Die ausgewählten AN erhalten die Einladung mit der zu bestätigenden Policy.",
      });
      onInvitationSent?.();
      close(false);
    } catch (error) {
      toast({
        title: "Versand nicht möglich",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Projekteinladung mit Datenfreigabe
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Einladung, Nutzungsrichtlinie und Informationspaket werden als ein gemeinsamer Auftrag vorbereitet.
          </p>
        </DialogHeader>

        <div className="flex items-center gap-1">
          {STEP_LABELS.map((label, index) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <span className={`grid h-6 w-6 place-content-center rounded-full text-[11px] font-bold ${
                  index < step ? "bg-primary text-primary-foreground" :
                  index === step ? "border border-primary bg-primary/10 text-primary" :
                  "bg-muted text-muted-foreground"
                }`}>{index < step ? "✓" : index + 1}</span>
                <span className={`hidden text-xs sm:block ${index === step ? "font-medium" : "text-muted-foreground"}`}>{label}</span>
              </div>
              {index < STEP_LABELS.length - 1 && <div className={`h-px flex-1 ${index < step ? "bg-primary" : "bg-border"}`} />}
            </React.Fragment>
          ))}
        </div>

        <div className="min-h-[320px] py-2">
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Wählen Sie verifizierte Nachunternehmen aus dem Dataspace-Directory. Bereits eingeladene oder aktive Teilnehmer sind nicht erneut auswählbar.
              </p>
              {selectableParticipants.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Keine verifizierten, noch nicht eingeladenen Teilnehmer verfügbar.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={participantSearch}
                      onChange={(event) => setParticipantSearch(event.target.value)}
                      placeholder="Teilnehmer suchen …"
                      aria-label="Teilnehmer suchen"
                      className="pl-9"
                    />
                  </div>
                  {filteredParticipants.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                      Keine Teilnehmer für „{participantSearch}“ gefunden.
                    </div>
                  ) : (
                    <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                      {filteredParticipants.map((participant) => (
                        <button
                          type="button"
                          key={participant.participantId}
                          onClick={() => toggleParticipant(participant.participantId)}
                          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left ${
                            selectedParticipants.has(participant.participantId) ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                          }`}
                        >
                          <Checkbox checked={selectedParticipants.has(participant.participantId)} onCheckedChange={() => toggleParticipant(participant.participantId)} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{participant.name}</span>
                            <span className="text-xs text-muted-foreground">Verifizierter Dataspace-Teilnehmer</span>
                          </span>
                          <Badge variant="secondary" className="text-[10px]">Verifiziert</Badge>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nutzungsrichtlinie</Label>
                <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                  <span className="flex-1">{selectedPolicy?.name ?? "Project Coordination Subcontractor"}</span>
                  {selectedPolicy && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setPolicyViewOpen(true)} className="shrink-0 gap-1.5">
                      <Eye className="h-3.5 w-3.5" /> Details &amp; ODRL
                    </Button>
                  )}
                </div>
                {(selectedPolicy?.availableTemplateVersions?.length ?? 0) > 1 && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="invitation-policy-version" className="text-xs text-muted-foreground">Template-Version</Label>
                    <Select
                      value={String(policyTemplateVersion ?? selectedPolicy?.templateVersion ?? "")}
                      onValueChange={(value) => setPolicyTemplateVersion(Number(value))}
                    >
                      <SelectTrigger id="invitation-policy-version" className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedPolicy?.availableTemplateVersions?.map((version) => (
                          <SelectItem key={version} value={String(version)}>v{version}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Titel des Informationspakets</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={autoTitle} />
              </div>
              <div className="space-y-2">
                <Label>Nachricht an die Teilnehmer (optional)</Label>
                <Textarea value={invitationMessage} onChange={(event) => setInvitationMessage(event.target.value)} rows={2} placeholder="Kurze Erläuterung zur Einladung…" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2"><Label>Gültig ab</Label><DatePicker value={validFrom} onChange={setValidFrom} /></div>
                <div className="space-y-2"><Label>Gültig bis</Label><DatePicker value={validUntil} onChange={setValidUntil} /></div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Nur ausgewählte, zugelassene Felder werden in den Snapshot aufgenommen.</p>
                <button type="button" onClick={() => setSelectedFields(selectedFields.size === ALL_FIELDS.length ? new Set() : new Set(ALL_FIELDS))} className="text-xs text-primary hover:underline">
                  {selectedFields.size === ALL_FIELDS.length ? "Alle abwählen" : "Alle wählen"}
                </button>
              </div>
              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {FIELD_GROUPS[PRODUCT_TYPE]?.map((group) => (
                  <div key={group.label} className="overflow-hidden rounded-xl border">
                    <div className="bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</div>
                    <div className="grid grid-cols-2 gap-x-3 px-3 py-2">
                      {group.fields.map((field) => (
                        <label key={field} className="flex items-center gap-2 py-1 text-sm">
                          <Checkbox checked={selectedFields.has(field)} onCheckedChange={() => toggleField(field)} />
                          {FIELD_LABELS[field] ?? field}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Interne Daten werden serverseitig zusätzlich ausgeschlossen.</p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Projekt</div><div className="font-semibold">{projectName}</div></div>
                <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Teilnehmer ({selectedParticipants.size})</div><div className="flex flex-wrap gap-1 mt-1">{participants.filter((p) => selectedParticipants.has(p.participantId)).map((p) => <Badge key={p.participantId} variant="secondary">{p.name}</Badge>)}</div></div>
                 <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Policy</div><div className="font-medium">{selectedPolicy?.name ?? "—"}{policyTemplateVersion ? ` · v${policyTemplateVersion}` : ""}</div></div>
                <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Freigegebene Datenfelder ({selectedFields.size})</div><div className="flex flex-wrap gap-1 mt-1">{Array.from(selectedFields).map((field) => <Badge key={field} variant="secondary" className="text-[10px]">{FIELD_LABELS[field] ?? field}</Badge>)}</div></div>
                <p className="rounded-md bg-primary/5 p-3 text-xs text-foreground/80">Mit dem Versand wird die Einladung gemeinsam mit der Policy und dem Informationspaket vorbereitet. Zugriff entsteht erst, wenn der AN die Einladung und Policy ausdrücklich bestätigt.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step > 0 && <Button type="button" variant="outline" onClick={() => setStep((current) => current - 1)} disabled={createPackage.isPending}><ChevronLeft className="mr-1 h-4 w-4" />Zurück</Button>}
          {step < 3 ? (
            <Button type="button" onClick={() => setStep((current) => current + 1)} disabled={!canContinue}>Weiter<ChevronRight className="ml-1 h-4 w-4" /></Button>
          ) : (
            <Button type="button" onClick={() => void send()} disabled={createPackage.isPending}><Send className="mr-1.5 h-4 w-4" />{createPackage.isPending ? "Wird versendet…" : "Einladung versenden"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
      </Dialog>
      {selectedPolicy && (
      <Dialog open={policyViewOpen} onOpenChange={setPolicyViewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{selectedPolicy.name}</DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="details">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="details">Policy-Details</TabsTrigger>
              <TabsTrigger value="odrl">ODRL / JSON-LD</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="max-h-[440px] space-y-3 overflow-y-auto py-3 text-sm">
              {selectedPolicy.description && <p>{selectedPolicy.description}</p>}
              <p className="text-muted-foreground">{selectedPolicy.purpose}</p>
              <div>
                <strong>Erlaubt:</strong>
                <ul className="ml-5 list-disc">{selectedPolicy.permissions.map((value) => <li key={value}>{value}</li>)}</ul>
              </div>
              <div>
                <strong>Nicht erlaubt:</strong>
                <ul className="ml-5 list-disc">{selectedPolicy.prohibitions.map((value) => <li key={value}>{value}</li>)}</ul>
              </div>
              <p><strong>Gültigkeit:</strong> {selectedPolicy.validityRule}</p>
              {selectedPolicy.retentionRule && <p><strong>Aufbewahrung:</strong> {selectedPolicy.retentionRule}</p>}
            </TabsContent>
            <TabsContent value="odrl" className="py-3">
              <pre className="max-h-[440px] overflow-y-auto rounded bg-muted/50 p-3 text-[11px]">
                {JSON.stringify(buildInvitationOdrl(selectedPolicy.code), null, 2)}
              </pre>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyViewOpen(false)}>Schließen</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      )}
    </>
  );
}