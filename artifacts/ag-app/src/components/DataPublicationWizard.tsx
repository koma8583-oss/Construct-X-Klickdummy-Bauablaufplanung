/**
 * DataPublicationWizard (Task #112).
 *
 * Separate AG data-publication flow for active project members.
 */
import React, { useEffect, useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/date-picker';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/auth-context';
import {
  useGetPolicyTemplates,
  useCreateDataPublication,
  usePublishDataPublication,
  FIELD_WHITELISTS,
  FIELD_LABELS,
  FIELD_GROUPS,
  type DataProductType,
  type PolicyTemplate,
} from '@workspace/api-client-react';
import {
  ChevronRight, ChevronLeft, Globe, Lock, Shield, Eye, ClipboardList,
} from 'lucide-react';

// ── Policy content display (shared by wizard + AG detail) ─────────────────────

function PolicyContentTab({ policy }: { policy: PolicyTemplate }) {
  const permissions  = policy.permissions  as string[];
  const prohibitions = policy.prohibitions as string[];
  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Zweck</div>
        <p className="text-foreground/80">{policy.purpose}</p>
      </div>
      {permissions.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">Erlaubt</div>
          <ul className="space-y-1">
            {permissions.map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {prohibitions.length > 0 && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-red-600 dark:text-red-400 mb-1">Nicht erlaubt</div>
          <ul className="space-y-1">
            {prohibitions.map((p, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1 w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {policy.validityRule && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Bedingungen</div>
          <p className="text-foreground/80">{policy.validityRule}</p>
        </div>
      )}
      {policy.retentionRule && (
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Aufbewahrung</div>
          <p className="text-foreground/80">{policy.retentionRule}</p>
        </div>
      )}
      {policy.description && (
        <div className="rounded-md bg-muted/40 border border-border px-3 py-2.5 text-xs text-muted-foreground italic">
          {policy.description}
        </div>
      )}
    </div>
  );
}

// ── Client-side ODRL preview generator (wizard — no publicationId yet) ────────
// Must stay in sync with artifacts/api-server/src/lib/odrl-builder.ts

type OdrlConstraint = { leftOperand: string; operator: string; rightOperand: string };

const POLICY_DEFINITIONS: Record<string, {
  purposeValue:    string;
  extraConstraints?: OdrlConstraint[];
  prohibitionActions: string[];
}> = {
  PROJECT_COORDINATION_READ_ONLY: {
    purposeValue: 'projectCoordination',
    prohibitionActions: ['distribute', 'derive', 'commercialize'],
  },
  TAKT_EXECUTION_USE: {
    purposeValue: 'taktExecution',
    prohibitionActions: ['distribute', 'commercialize'],
  },
  EXTENDED_PROJECT_COLLABORATION: {
    purposeValue: 'projectExecution',
    prohibitionActions: ['distribute', 'commercialize'],
  },
  SCHEDULE_COORDINATION: {
    purposeValue: 'scheduleCoordination',
    extraConstraints: [
      { leftOperand: 'taktkoord:scope',       operator: 'eq', rightOperand: 'taktkoord:projectSpecific' },
      { leftOperand: 'taktkoord:internalUse', operator: 'eq', rightOperand: 'taktkoord:restrictedToRecipient' },
      { leftOperand: 'taktkoord:contentScope', operator: 'eq', rightOperand: 'taktkoord:projectAndRequestedService' },
    ],
    prohibitionActions: ['distribute', 'derive', 'modify', 'commercialize'],
  },
  COORDINATION_USE: {
    purposeValue: 'coordinationUse',
    extraConstraints: [
      { leftOperand: 'taktkoord:scope', operator: 'eq', rightOperand: 'taktkoord:projectSpecific' },
    ],
    prohibitionActions: ['distribute', 'derive', 'modify'],
  },
  READ_ONLY: {
    purposeValue: 'readOnly',
    prohibitionActions: ['distribute', 'derive', 'modify', 'archive'],
  },
  SUBCONTRACTOR_FULL: {
    purposeValue: 'subcontractorFull',
    extraConstraints: [
      { leftOperand: 'taktkoord:scope', operator: 'eq', rightOperand: 'taktkoord:contractScope' },
    ],
    prohibitionActions: ['distribute', 'commercialize'],
  },
};

function buildPreviewOdrl(policy: PolicyTemplate, agOrgId: string): Record<string, unknown> {
  const def = POLICY_DEFINITIONS[policy.code] ?? {
    purposeValue:       policy.code.toLowerCase().replace(/_/g, ''),
    prohibitionActions: ['distribute', 'derive'],
  };
  const constraints: OdrlConstraint[] = [
    { leftOperand: 'purpose', operator: 'eq', rightOperand: def.purposeValue },
    ...(def.extraConstraints ?? []),
  ];
  return {
    '@context': 'http://www.w3.org/ns/odrl.jsonld',
    '@type':    'Set',
    'uid':      'urn:odrl:data-publication:preview',
    'permission': [{
      'target':     'data-publication:preview',
      'assigner':   `organization:${agOrgId}`,
      'assignee':   'organization:<nu-org-id>',
      'action':     'use',
      'constraint': constraints,
    }],
    'prohibition': def.prohibitionActions.map((action) => ({
      'target': 'data-publication:preview',
      action,
    })),
  };
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface ContractorOption {
  id: string;
  name: string;
  orgId: string;
  assignmentStatus: string;
  trade?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  contractors: ContractorOption[];
  initialRecipientIds?: string[];
}

// The only product type is TAKT_INFORMATION_PACKAGE — no selection step needed.
const PRODUCT_LABEL = 'Informationspaket Leistungsvergabe';

// Steps: 0 = Empfänger, 1 = Policy, 2 = Daten auswählen, 3 = Freigabe prüfen
const STEP_LABELS = ['Empfänger', 'Policy', 'Daten auswählen', 'Freigabe prüfen'];
const PRODUCT_TYPE: DataProductType = 'TAKT_INFORMATION_PACKAGE';
const ALL_FIELDS = FIELD_WHITELISTS[PRODUCT_TYPE];

// ── Component ─────────────────────────────────────────────────────────────────

export function DataPublicationWizard({
  open,
  onOpenChange,
  projectId,
  projectName,
  contractors,
  initialRecipientIds = [],
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set(ALL_FIELDS));
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [policyTemplateId, setPolicyTemplateId] = useState('');
  const [policyTemplateVersion, setPolicyTemplateVersion] = useState<number | undefined>();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [policyViewOpen, setPolicyViewOpen] = useState(false);

  const { data: policyTemplates } = useGetPolicyTemplates();
  const createDataPublication = useCreateDataPublication(projectId);
  const publishDataPublication = usePublishDataPublication();

  const activeContractors = contractors.filter((c) => c.assignmentStatus === 'ACTIVE');
  const selectedPolicy = policyTemplates?.find((p) => p.id === policyTemplateId);
  const allowedFields = selectedPolicy?.allowedPublicationFields ?? ALL_FIELDS;
  const allowedFieldSet = useMemo(() => new Set(allowedFields), [allowedFields]);
  const visibleFieldGroups = useMemo(
    () => (FIELD_GROUPS[PRODUCT_TYPE] ?? [])
      .map((group) => ({
        ...group,
        fields: group.fields.filter((field) => allowedFieldSet.has(field)),
      }))
      .filter((group) => group.fields.length > 0),
    [allowedFieldSet],
  );

  useEffect(() => {
    if (open) {
      setSelectedRecipients(new Set(initialRecipientIds));
    }
  }, [open, initialRecipientIds]);

  useEffect(() => {
    if (!selectedPolicy?.allowedPublicationFields) return;
    setSelectedFields((previous) => {
      const next = new Set([...previous].filter((field) => allowedFieldSet.has(field)));
      return next.size === previous.size ? previous : next;
    });
  }, [allowedFieldSet, selectedPolicy?.allowedPublicationFields]);

  const autoTitle = useMemo(() => {
    const dt = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${PRODUCT_LABEL} – ${projectName} – ${dt}`;
  }, [projectName]);

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setStep(0);
      setSelectedFields(new Set(ALL_FIELDS));
      setSelectedRecipients(new Set());
      setPolicyTemplateId('');
      setPolicyTemplateVersion(undefined);
      setTitle('');
      setDescription('');
      setValidFrom('');
      setValidUntil('');
    }
    onOpenChange(v);
  };

  const toggleField = (f: string) =>
    setSelectedFields((prev) => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });

  const toggleRecipient = (orgId: string) =>
    setSelectedRecipients((prev) => { const n = new Set(prev); n.has(orgId) ? n.delete(orgId) : n.add(orgId); return n; });

  const canNext = useMemo(() => {
    if (step === 0) return selectedRecipients.size > 0;
    if (step === 1) return !!policyTemplateId && !!title.trim();
    if (step === 2) return selectedFields.size > 0;
    return true;
  }, [step, selectedFields, selectedRecipients, policyTemplateId, title]);

  const handleNext = () => {
    if (step === 0 && !title) setTitle(autoTitle);
    setStep((s) => Math.min(s + 1, 3));
  };

  const handlePublish = async () => {
    if (!policyTemplateId) return;
    try {
      const publication = await createDataPublication.mutateAsync({
        dataProductType: PRODUCT_TYPE,
        title: title.trim() || autoTitle,
        description: description.trim() || undefined,
        policyTemplateId,
        selectedFields: Array.from(selectedFields),
        recipientAnOrgIds: Array.from(selectedRecipients),
        validFrom: validFrom ? `${validFrom}T00:00:00Z` : undefined,
        validUntil: validUntil ? `${validUntil}T23:59:59Z` : undefined,
      });
      await publishDataPublication.mutateAsync(publication.id);
      toast({ title: 'Datenfreigabe veröffentlicht', description: 'Die Datenfreigabe wurde separat für aktive Projektmitglieder bereitgestellt.' });
      handleOpenChange(false);
    } catch (err) {
      toast({ title: 'Fehler bei der Datenfreigabe', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const isPending = createDataPublication.isPending || publishDataPublication.isPending;

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5 text-primary" />
             <span>Daten für Projektpartner freigeben</span>
          </DialogTitle>
          <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground/80 space-y-1">
            <p>
               Diese Datenfreigabe ist ein eigener Schritt nach der aktiven
               Projektmitgliedschaft. Wählen Sie eine Policy und nur die Felder,
               die der AN sehen darf.
            </p>
            <p className="text-xs text-muted-foreground flex items-start gap-1.5 pt-0.5">
              <Lock className="h-3 w-3 shrink-0 mt-0.5" />
              <span>Detailinformationen zu einer konkreten Leistung sind erst zugänglich, wenn der Empfänger die Nutzungsrichtlinie akzeptiert hat <em>und</em> ihm diese Leistung explizit zugeordnet wurde.</span>
            </p>
          </div>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {STEP_LABELS.map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors ${
                  i < step ? 'bg-primary text-primary-foreground'
                  : i === step ? 'bg-primary/20 text-primary border border-primary'
                  : 'bg-muted text-muted-foreground'
                }`}>
                  {i < step ? '✓' : i + 1}
                </div>
                <span className={`text-xs hidden sm:block ${i === step ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`flex-1 h-px mx-1 ${i < step ? 'bg-primary' : 'bg-border'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="min-h-[300px] py-2">

          {/* ── Step 2: Felder ────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Wählen Sie die Informationen, die für den Empfänger sichtbar sein sollen.
                </p>
                <button
                  type="button"
                  onClick={() => setSelectedFields(
                    selectedFields.size === allowedFields.length ? new Set() : new Set(allowedFields)
                  )}
                  className="text-xs text-primary hover:underline shrink-0 ml-3"
                >
                  {selectedFields.size === allowedFields.length ? 'Alle abwählen' : 'Alle wählen'}
                </button>
              </div>

              {/* Grouped fields */}
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {visibleFieldGroups.map((group) => (
                  <div key={group.label} className="border border-border rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        const allSel = group.fields.every(f => selectedFields.has(f));
                        setSelectedFields(prev => {
                          const n = new Set(prev);
                          allSel ? group.fields.forEach(f => n.delete(f)) : group.fields.forEach(f => n.add(f));
                          return n;
                        });
                      }}
                      className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
                    >
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</span>
                      <span className="text-[10px] text-primary">
                        {group.fields.filter(f => selectedFields.has(f)).length}/{group.fields.length}
                      </span>
                    </button>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0 px-3 py-2">
                      {group.fields.map((f) => (
                        <div key={f} className="flex items-center gap-2 py-1">
                          <Checkbox id={`field-${f}`} checked={selectedFields.has(f)} onCheckedChange={() => toggleField(f)} />
                          <label htmlFor={`field-${f}`} className="text-sm cursor-pointer leading-tight">{FIELD_LABELS[f] ?? f}</label>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground flex items-center gap-1">
                 <Lock className="h-3 w-3 shrink-0" />
                   Nicht ausgewählte oder intern geschützte Felder bleiben ausschließlich im AG-System.
              </p>
            </div>
          )}

          {/* ── Step 0: Empfänger ─────────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                   Wählen Sie die aktiven Projektmitglieder, die diese Datenfreigabe erhalten sollen.
              </p>
              {activeContractors.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-8 text-center">
                  Keine aktiven Nachunternehmer für dieses Projekt gefunden.
                </p>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {activeContractors.map((c) => (
                    <div
                      key={c.orgId}
                      onClick={() => toggleRecipient(c.orgId)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedRecipients.has(c.orgId) ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30'
                      }`}
                    >
                      <Checkbox
                        checked={selectedRecipients.has(c.orgId)}
                        onCheckedChange={() => toggleRecipient(c.orgId)}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        {c.trade && <div className="text-xs text-muted-foreground">{c.trade}</div>}
                      </div>
                      <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">Aktiv</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 1: Policy ────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Titel der Veröffentlichung</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={autoTitle} />
              </div>
              <div className="space-y-2">
                 <Label>Beschreibung der Datenfreigabe (optional)</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kurze Beschreibung für die Empfänger…" rows={2} />
              </div>
              <div className="space-y-2">
                <Label>Nutzungsrichtlinie</Label>
                <div className="flex gap-2">
                  <Select
                    value={policyTemplateId}
                    onValueChange={(value) => {
                      setPolicyTemplateId(value);
                      setPolicyTemplateVersion(policyTemplates?.find((policy) => policy.id === value)?.templateVersion);
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Richtlinie wählen…" />
                    </SelectTrigger>
                    <SelectContent>
                      {policyTemplates?.map((pt) => (
                        <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {(selectedPolicy?.availableTemplateVersions?.length ?? 0) > 1 && (
                    <Select
                      value={String(policyTemplateVersion ?? selectedPolicy?.templateVersion ?? "")}
                      onValueChange={(value) => setPolicyTemplateVersion(Number(value))}
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedPolicy?.availableTemplateVersions?.map((version) => (
                          <SelectItem key={version} value={String(version)}>v{version}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  {selectedPolicy && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setPolicyViewOpen(true)} className="shrink-0 gap-1.5">
                      <Eye className="h-3.5 w-3.5" /> Policy anzeigen
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Gültig ab (optional)</Label>
                  <DatePicker value={validFrom} onChange={setValidFrom} />
                </div>
                <div className="space-y-2">
                  <Label>Gültig bis (optional)</Label>
                  <DatePicker value={validUntil} onChange={setValidUntil} />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 3: Vorschau ──────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-xl border bg-card p-4 space-y-4">
                <div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-0.5">Informationspaket</div>
                  <h3 className="font-semibold">{title || autoTitle}</h3>
                  {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
                </div>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <div className="text-muted-foreground text-xs uppercase tracking-wider">Policy</div>
                    <div className="font-medium">{selectedPolicy?.name ?? '—'}{policyTemplateVersion ? ` · v${policyTemplateVersion}` : ''}</div>
                  </div>
                  {(validFrom || validUntil) && (
                    <div>
                      <div className="text-muted-foreground text-xs uppercase tracking-wider">Gültig</div>
                      <div className="font-medium">{validFrom || '…'} – {validUntil || '∞'}</div>
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1.5">
                    Wird freigegeben ({selectedFields.size} Felder)
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(selectedFields).map((f) => (
                      <Badge key={f} variant="secondary" className="text-[10px]">{FIELD_LABELS[f] ?? f}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1.5">
                    Bleibt intern ({ALL_FIELDS.filter((field) => !selectedFields.has(field)).length} Felder)
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ALL_FIELDS.filter((field) => !selectedFields.has(field)).map((field) => (
                      <Badge key={field} variant="outline" className="text-[10px]">{FIELD_LABELS[field] ?? field}</Badge>
                    ))}
                    {ALL_FIELDS.every((field) => selectedFields.has(field)) && (
                      <span className="text-xs text-muted-foreground">Keine weiteren Felder ausgeschlossen.</span>
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground text-xs uppercase tracking-wider mb-1.5">
                    Empfänger ({selectedRecipients.size})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {activeContractors.filter((c) => selectedRecipients.has(c.orgId)).map((c) => (
                      <Badge key={c.orgId} variant="outline" className="text-[10px]">{c.name}</Badge>
                    ))}
                  </div>
                </div>
                <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5"><Lock className="h-3 w-3" /> Interne Felder bleiben ausschließlich im AG-System.</div>
                  <div className="flex items-center gap-1.5"><Shield className="h-3 w-3" /> Empfänger müssen die Nutzungsrichtlinie akzeptieren, bevor sie zugreifen können.</div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between !flex-row gap-3">
          <Button type="button" variant="outline" onClick={() => (step === 0 ? handleOpenChange(false) : setStep((s) => s - 1))} disabled={isPending}>
            {step === 0 ? 'Abbrechen' : <><ChevronLeft className="h-4 w-4 mr-1" /> Zurück</>}
          </Button>
          <div className="flex items-center gap-2">
            {step < 3 ? (
              <Button type="button" onClick={handleNext} disabled={!canNext}>
                Weiter <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button type="button" onClick={handlePublish} disabled={isPending || !canNext} className="min-w-36">
                {isPending ? 'Wird veröffentlicht…' : <><Globe className="h-4 w-4 mr-1.5" /> Datenfreigabe veröffentlichen</>}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Policy-Ansicht Dialog ─────────────────────────────────────────────── */}
    {selectedPolicy && (
      <Dialog open={policyViewOpen} onOpenChange={setPolicyViewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              {selectedPolicy.name}
            </DialogTitle>
          </DialogHeader>
          <Tabs defaultValue="inhalt" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="inhalt">Inhalt</TabsTrigger>
              <TabsTrigger value="odrl">ODRL / JSON-LD</TabsTrigger>
            </TabsList>
            <TabsContent value="inhalt" className="mt-4 max-h-[420px] overflow-y-auto pr-1">
              <PolicyContentTab policy={selectedPolicy} />
            </TabsContent>
            <TabsContent value="odrl" className="mt-4">
              <p className="text-[11px] text-muted-foreground mb-2 italic">
                Vorschau — Platzhalter werden beim Veröffentlichen ersetzt.
              </p>
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/50 rounded p-3 max-h-[380px] overflow-y-auto">
                {JSON.stringify(buildPreviewOdrl(selectedPolicy, user?.orgId ?? 'ag-org'), null, 2)}
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
