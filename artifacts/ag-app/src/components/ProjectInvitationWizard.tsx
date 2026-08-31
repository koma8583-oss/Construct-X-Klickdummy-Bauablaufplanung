import React, { useEffect, useMemo, useState } from "react";
import {
  useCreateProjectInvitationPackage,
  useGetPolicyTemplateRegistry,
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
import { ChevronLeft, ChevronRight, Eye, Search, Send, ShieldCheck, Users } from "lucide-react";

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

const PROJECT_MEMBERSHIP_FIELDS = [
  "projectReference",
  "projectName",
  "projectStatus",
  "projectLocation",
] as const;
const PROJECT_MEMBERSHIP_FIELD_LABELS: Record<string, string> = {
  projectReference: "Projektreferenz (ID)",
  projectName: "Projektname",
  projectStatus: "Projektstatus",
  projectLocation: "Projektstandort / Bauvorhaben",
};
const STEP_LABELS = ["Teilnehmer", "Policy", "Übersicht"];

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
       { leftOperand: "taktkoord:contentScope", operator: "eq", rightOperand: "taktkoord:projectMembershipOnly" },
      ],
    }],
    prohibition: [
      { target: "data-publication:project-invitation-preview", action: "distribute" },
      { target: "data-publication:project-invitation-preview", action: "derive" },
      { target: "data-publication:project-invitation-preview", action: "modify" },
      { target: "data-publication:project-invitation-preview", action: "commercialize" },
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
  const [title, setTitle] = useState("");
  const [invitationMessage, setInvitationMessage] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [policyViewOpen, setPolicyViewOpen] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const { data: policies } = useGetPolicyTemplateRegistry();
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
    () => (policies ?? [])
      .filter((policy) => policy.code === "PROJECT_MEMBERSHIP")
      .sort((a, b) => b.version - a.version),
    [policies],
  );
  const selectedPolicy = invitationPolicies[0];
  useEffect(() => {
    if (selectedPolicy && policyTemplateId !== selectedPolicy.code) {
      setPolicyTemplateId(selectedPolicy.code);
    }
    if (selectedPolicy && policyTemplateVersion === undefined) {
      setPolicyTemplateVersion(selectedPolicy.version);
    }
  }, [selectedPolicy, policyTemplateId, policyTemplateVersion]);
  const autoTitle = useMemo(
    () => `Projektaufnahme – ${projectName}`,
    [projectName],
  );

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep(0);
      setSelectedParticipants(new Set());
       setParticipantSearch("");
      setPolicyTemplateId("");
      setPolicyTemplateVersion(undefined);
      setTitle("");
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
  const canContinue = [
    selectedParticipants.size > 0,
    Boolean(policyTemplateId),
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
           selectedFields: [...PROJECT_MEMBERSHIP_FIELDS],
          title: title.trim() || autoTitle,
          invitationMessage: invitationMessage.trim() || undefined,
          validFrom: validFrom ? `${validFrom}T00:00:00Z` : undefined,
          validUntil: validUntil ? `${validUntil}T23:59:59Z` : undefined,
          idempotencyKey,
        },
      });
      toast({
         title: "Projektaufnahme versendet",
         description: "Die ausgewählten AN erhalten die Projektaufnahme mit der zu bestätigenden Policy.",
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
             Die Projektaufnahme enthält nur wenige Projektbasisdaten. Die Projektpartnerschaft entsteht erst nach ausdrücklicher Annahme durch den AN.
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
                   <span className="flex-1">{selectedPolicy?.name ?? "Projektaufnahme"}</span>
                  {selectedPolicy && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setPolicyViewOpen(true)} className="shrink-0 gap-1.5">
                      <Eye className="h-3.5 w-3.5" /> Details &amp; ODRL
                    </Button>
                  )}
                </div>
                 <p className="text-xs text-muted-foreground">
                   Feste Registry-Version: v{selectedPolicy?.version ?? "—"}
                 </p>
              </div>
              <div className="space-y-2">
                 <Label>Titel der Projektaufnahme</Label>
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
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-3">
                <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Projekt</div><div className="font-semibold">{projectName}</div></div>
                <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Teilnehmer ({selectedParticipants.size})</div><div className="flex flex-wrap gap-1 mt-1">{participants.filter((p) => selectedParticipants.has(p.participantId)).map((p) => <Badge key={p.participantId} variant="secondary">{p.name}</Badge>)}</div></div>
                 <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Policy</div><div className="font-medium">{selectedPolicy?.name ?? "—"}{policyTemplateVersion ? ` · v${policyTemplateVersion}` : ""}</div></div>
                 <div><div className="text-xs uppercase tracking-wider text-muted-foreground">Feste Projektbasisdaten</div><div className="flex flex-wrap gap-1 mt-1">{PROJECT_MEMBERSHIP_FIELDS.map((field) => <Badge key={field} variant="secondary" className="text-[10px]">{PROJECT_MEMBERSHIP_FIELD_LABELS[field]}</Badge>)}</div></div>
                 <p className="rounded-md bg-primary/5 p-3 text-xs text-foreground/80">Keine Leistungs-, Takt-, Ablauf-, Ressourcen- oder Logistikdaten. Zugriff und aktive Projektpartnerschaft entstehen erst, wenn der AN die Einladung und Policy ausdrücklich bestätigt.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step > 0 && <Button type="button" variant="outline" onClick={() => setStep((current) => current - 1)} disabled={createPackage.isPending}><ChevronLeft className="mr-1 h-4 w-4" />Zurück</Button>}
           {step < 2 ? (
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