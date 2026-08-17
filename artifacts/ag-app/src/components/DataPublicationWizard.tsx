/**
 * DataPublicationWizard (Task #112).
 *
 * 5-step wizard for AG to publish project/Takt data to selected ANs:
 *   Step 1 — Datenprodukt: product type selection
 *   Step 2 — Felder: checkbox selection from whitelist
 *   Step 3 — Empfänger: select from ACTIVE project contractors
 *   Step 4 — Policy + Gültigkeitsdatum: policy template + optional dates
 *   Step 5 — Vorschau: preview of what will be shared + publish action
 */
import React, { useState, useMemo } from 'react';
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
  ChevronRight, ChevronLeft, Globe, CheckCircle2, Lock, Shield, Eye,
  Package, FolderKanban, ClipboardList,
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
  SCHEDULE_COORDINATION: {
    purposeValue: 'scheduleCoordination',
    extraConstraints: [
      { leftOperand: 'taktkoord:scope',       operator: 'eq', rightOperand: 'taktkoord:projectSpecific' },
      { leftOperand: 'taktkoord:internalUse', operator: 'eq', rightOperand: 'taktkoord:restrictedToRecipient' },
    ],
    prohibitionActions: ['distribute'], // no "derive" for this policy
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
  takte?: { id: string; taktBezeichnung: string; zone: string }[];
}

// ── Labels & product metadata ─────────────────────────────────────────────────

type ProductMeta = {
  label: string;
  tagline: string;
  description: string;
  contents: string[];
  icon: React.ElementType;
  color: string;
};

const PRODUCT_META: Record<DataProductType, ProductMeta> = {
  TAKT_INFORMATION_PACKAGE: {
    label: 'Informationspaket Leistungsvergabe',
    tagline: 'Für die Auftragsvergabe an Nachunternehmen',
    description:
      'Enthält alle relevanten Informationen zu einer Leistung, die ein Nachunternehmen für die Angebotsstellung oder Ausführungsplanung benötigt.',
    contents: [
      'Leistungsbezeichnung & Gewerk',
      'Geplantes Zeitfenster & Puffer',
      'Ausführungsort / Zone',
      'Hinweise zur Ausführung',
      'Ressourcenbedarf & Logistische Vorgaben',
      'Vorgänger- & Nachfolger-Leistungen',
    ],
    icon: ClipboardList,
    color: 'text-primary bg-primary/10 border-primary/20',
  },
  PROJECT_OVERVIEW: {
    label: 'Projektübersicht',
    tagline: 'Basisinformationen zum Projekt',
    description:
      'Stellt allgemeine Projektdaten bereit: Name, Status, Laufzeit und beteiligte Gewerke. Geeignet für eine erste Übersicht.',
    contents: [
      'Projektname & Status',
      'Projektbeginn & -ende',
      'Gewerk / Fachbereich',
      'Arbeitspaket-Referenz',
      'Meilensteine',
    ],
    icon: FolderKanban,
    color: 'text-blue-600 bg-blue-500/10 border-blue-500/20',
  },
  PROJECT_COORDINATION_PACKAGE: {
    label: 'Koordinationspaket',
    tagline: 'Für die übergreifende Terminkoordination',
    description:
      'Koordinationsrelevante Daten für die gemeinsame Ablaufplanung: Meilensteine, Schnittstellen, Zeitfenster und Logistikvorgaben.',
    contents: [
      'Meilensteine & Zeitfenster',
      'Logistische Vorgaben',
      'Koordinations-Vorgaben',
      'Schnittstellenbeschreibungen',
      'Dokumentenverweise',
    ],
    icon: Package,
    color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20',
  },
};

// For backward compatibility with autoTitle etc.
const PRODUCT_LABELS: Record<DataProductType, { label: string; description: string }> = Object.fromEntries(
  (Object.entries(PRODUCT_META) as [DataProductType, ProductMeta][]).map(([k, v]) => [
    k,
    { label: v.label, description: v.description },
  ]),
) as Record<DataProductType, { label: string; description: string }>;

const STEP_LABELS = [
  'Datenprodukt',
  'Felder',
  'Empfänger',
  'Policy',
  'Vorschau',
];

// ── Component ─────────────────────────────────────────────────────────────────

export function DataPublicationWizard({
  open,
  onOpenChange,
  projectId,
  projectName,
  contractors,
  takte,
}: Props) {
  const { toast } = useToast();

  // wizard state
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [productType, setProductType] = useState<DataProductType | ''>('');
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [selectedTaktIds, setSelectedTaktIds] = useState<Set<string>>(new Set());
  const [selectedRecipients, setSelectedRecipients] = useState<Set<string>>(new Set());
  const [policyTemplateId, setPolicyTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [policyViewOpen, setPolicyViewOpen] = useState(false);

  // queries
  const { data: policyTemplates } = useGetPolicyTemplates();
  const createPub = useCreateDataPublication(projectId);
  const publishPub = usePublishDataPublication();

  const activeContractors = contractors.filter((c) => c.assignmentStatus === 'ACTIVE');
  const currentFields = productType ? FIELD_WHITELISTS[productType] : [];
  const selectedPolicy = policyTemplates?.find((p) => p.id === policyTemplateId);

  // reset on open/close
  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setStep(0);
      setProductType('');
      setSelectedFields(new Set());
      setSelectedTaktIds(new Set());
      setSelectedRecipients(new Set());
      setPolicyTemplateId('');
      setTitle('');
      setDescription('');
      setValidFrom('');
      setValidUntil('');
    }
    onOpenChange(v);
  };

  const toggleField = (f: string) =>
    setSelectedFields((prev) => {
      const next = new Set(prev);
      next.has(f) ? next.delete(f) : next.add(f);
      return next;
    });

  const toggleRecipient = (orgId: string) =>
    setSelectedRecipients((prev) => {
      const next = new Set(prev);
      next.has(orgId) ? next.delete(orgId) : next.add(orgId);
      return next;
    });

  const toggleTakt = (id: string) =>
    setSelectedTaktIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const handleSelectAllFields = () => {
    if (selectedFields.size === currentFields.length) {
      setSelectedFields(new Set());
    } else {
      setSelectedFields(new Set(currentFields));
    }
  };

  // Auto-generate title when product type changes
  const autoTitle = useMemo(() => {
    if (!productType) return '';
    const dt = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return `${PRODUCT_LABELS[productType].label} – ${projectName} – ${dt}`;
  }, [productType, projectName]);

  // Step navigation
  const canNext = useMemo(() => {
    if (step === 0) return !!productType;
    if (step === 1) return selectedFields.size > 0;
    if (step === 2) return selectedRecipients.size > 0;
    if (step === 3) return !!policyTemplateId && !!title.trim();
    return true;
  }, [step, productType, selectedFields, selectedRecipients, policyTemplateId, title]);

  const handleNext = () => {
    if (step === 0 && productType) {
      // Pre-select all fields
      setSelectedFields(new Set(FIELD_WHITELISTS[productType]));
      if (!title) setTitle(autoTitle);
    }
    setStep((s) => Math.min(s + 1, 4));
  };

  // Final publish
  const handlePublish = async () => {
    if (!productType || !policyTemplateId) return;
    try {
      const pub = await createPub.mutateAsync({
        dataProductType: productType,
        title: title.trim() || autoTitle,
        description: description.trim() || undefined,
        policyTemplateId,
        selectedFields: Array.from(selectedFields),
        selectedTaktIds:
          productType === 'TAKT_INFORMATION_PACKAGE'
            ? Array.from(selectedTaktIds)
            : undefined,
        recipientAnOrgIds: Array.from(selectedRecipients),
        validFrom: validFrom ? `${validFrom}T00:00:00Z` : undefined,
        validUntil: validUntil ? `${validUntil}T23:59:59Z` : undefined,
      });

      await publishPub.mutateAsync(pub.id);
      toast({ title: 'Daten erfolgreich bereitgestellt', description: 'Die ausgewählten Empfänger wurden benachrichtigt.' });
      handleOpenChange(false);
    } catch (err) {
      toast({
        title: 'Fehler bei der Bereitstellung',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const isPending = createPub.isPending || publishPub.isPending;

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" />
            Im Datenraum bereitstellen
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-2">
          {STEP_LABELS.map((label, i) => (
            <React.Fragment key={label}>
              <div className="flex items-center gap-1.5">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 transition-colors ${
                    i < step
                      ? 'bg-primary text-primary-foreground'
                      : i === step
                      ? 'bg-primary/20 text-primary border border-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </div>
                <span
                  className={`text-xs hidden sm:block ${
                    i === step ? 'text-foreground font-medium' : 'text-muted-foreground'
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={`flex-1 h-px mx-1 ${i < step ? 'bg-primary' : 'bg-border'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div className="min-h-[280px] py-2">
          {/* ── Step 0: Datenprodukt ─────────────────────────────────────── */}
          {step === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Wählen Sie das Datenprodukt, das Sie für Ihre Nachunternehmen bereitstellen möchten.
              </p>
              {/* Primary product first, then others */}
              {(['TAKT_INFORMATION_PACKAGE', 'PROJECT_OVERVIEW', 'PROJECT_COORDINATION_PACKAGE'] as DataProductType[]).map((type) => {
                const meta = PRODUCT_META[type];
                const Icon = meta.icon;
                const isPrimary = type === 'TAKT_INFORMATION_PACKAGE';
                const isSelected = productType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setProductType(type)}
                    className={`w-full text-left rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border hover:border-primary/40 hover:bg-muted/20'
                    }`}
                  >
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${meta.color}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm">{meta.label}</span>
                              {isPrimary && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                                  Empfohlen
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{meta.tagline}</p>
                          </div>
                        </div>
                        {isSelected && (
                          <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                        )}
                      </div>

                      {/* Inhalt-Bullets */}
                      <div className={`mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 transition-all ${isSelected ? 'opacity-100' : 'opacity-60'}`}>
                        {meta.contents.map((c) => (
                          <div key={c} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <span className="w-1 h-1 rounded-full bg-muted-foreground/60 shrink-0" />
                            {c}
                          </div>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Step 1: Felder ───────────────────────────────────────────── */}
          {step === 1 && productType && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Wählen Sie die Informationen, die für den Empfänger sichtbar sein sollen.
                </p>
                <button
                  type="button"
                  onClick={handleSelectAllFields}
                  className="text-xs text-primary hover:underline shrink-0 ml-3"
                >
                  {selectedFields.size === currentFields.length ? 'Alle abwählen' : 'Alle wählen'}
                </button>
              </div>

              {/* Leistungs-Auswahl (nur TAKT_INFORMATION_PACKAGE) */}
              {productType === 'TAKT_INFORMATION_PACKAGE' && takte && takte.length > 0 && (
                <div className="border rounded-xl p-3 space-y-2 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Leistungen einschließen
                    </Label>
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedTaktIds.size === takte.length) {
                          setSelectedTaktIds(new Set());
                        } else {
                          setSelectedTaktIds(new Set(takte.map(t => t.id)));
                        }
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      {selectedTaktIds.size === takte.length ? 'Alle abwählen' : 'Alle wählen'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 max-h-28 overflow-y-auto pr-1">
                    {takte.map((t) => (
                      <div key={t.id} className="flex items-center gap-2">
                        <Checkbox
                          id={`takt-${t.id}`}
                          checked={selectedTaktIds.has(t.id)}
                          onCheckedChange={() => toggleTakt(t.id)}
                        />
                        <label htmlFor={`takt-${t.id}`} className="text-xs cursor-pointer leading-tight">
                          {t.taktBezeichnung}
                          {t.zone && <span className="text-muted-foreground"> · {t.zone}</span>}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Grouped fields (TAKT_INFORMATION_PACKAGE) */}
              {FIELD_GROUPS[productType] ? (
                <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
                  {FIELD_GROUPS[productType]!.map((group) => (
                    <div key={group.label} className="border border-border rounded-xl overflow-hidden">
                      {/* Group header with select-all toggle */}
                      <button
                        type="button"
                        onClick={() => {
                          const allSelected = group.fields.every(f => selectedFields.has(f));
                          setSelectedFields(prev => {
                            const next = new Set(prev);
                            if (allSelected) group.fields.forEach(f => next.delete(f));
                            else group.fields.forEach(f => next.add(f));
                            return next;
                          });
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors"
                      >
                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.label}
                        </span>
                        <span className="text-[10px] text-primary">
                          {group.fields.filter(f => selectedFields.has(f)).length}/{group.fields.length}
                        </span>
                      </button>
                      {/* Fields */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 px-3 py-2">
                        {group.fields.map((f) => (
                          <div key={f} className="flex items-center gap-2 py-1">
                            <Checkbox
                              id={`field-${f}`}
                              checked={selectedFields.has(f)}
                              onCheckedChange={() => toggleField(f)}
                            />
                            <label htmlFor={`field-${f}`} className="text-sm cursor-pointer leading-tight">
                              {FIELD_LABELS[f] ?? f}
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Flat field list for PROJECT_OVERVIEW / PROJECT_COORDINATION_PACKAGE */
                <div className="grid grid-cols-2 gap-2 max-h-52 overflow-y-auto pr-1">
                  {currentFields.map((f) => (
                    <div key={f} className="flex items-center gap-2 py-1">
                      <Checkbox
                        id={`field-${f}`}
                        checked={selectedFields.has(f)}
                        onCheckedChange={() => toggleField(f)}
                      />
                      <label htmlFor={`field-${f}`} className="text-sm cursor-pointer">
                        {FIELD_LABELS[f] ?? f}
                      </label>
                    </div>
                  ))}
                </div>
              )}

              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Lock className="h-3 w-3 shrink-0" />
                Interne Felder (Kalkulation, Risikobewertung, Notizen) werden niemals übertragen.
              </p>
            </div>
          )}

          {/* ── Step 2: Empfänger ─────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Wählen Sie die Nachunternehmen, die diese Daten erhalten sollen. Nur aktive Zuordnungen können ausgewählt werden.
              </p>
              {activeContractors.length === 0 ? (
                <p className="text-sm text-muted-foreground italic py-4 text-center">
                  Keine aktiven Nachunternehmer für dieses Projekt gefunden.
                </p>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {activeContractors.map((c) => (
                    <div
                      key={c.orgId}
                      onClick={() => toggleRecipient(c.orgId)}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedRecipients.has(c.orgId)
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40 hover:bg-muted/30'
                      }`}
                    >
                      <Checkbox
                        checked={selectedRecipients.has(c.orgId)}
                        onCheckedChange={() => toggleRecipient(c.orgId)}
                        className="shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{c.name}</div>
                        {c.trade && (
                          <div className="text-xs text-muted-foreground">{c.trade}</div>
                        )}
                      </div>
                      <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                        Aktiv
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Policy + Gültigkeitsdatum ──────────────────────────── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Titel der Veröffentlichung</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={autoTitle}
                />
              </div>
              <div className="space-y-2">
                <Label>Beschreibung (optional)</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Kurze Beschreibung für die Empfänger…"
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>Nutzungsrichtlinie (Policy)</Label>
                <div className="flex gap-2">
                  <Select value={policyTemplateId} onValueChange={setPolicyTemplateId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Richtlinie wählen…" />
                    </SelectTrigger>
                    <SelectContent>
                      {policyTemplates?.map((pt) => (
                        <SelectItem key={pt.id} value={pt.id}>
                          {pt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedPolicy && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPolicyViewOpen(true)}
                      className="shrink-0 gap-1.5"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Policy anzeigen
                    </Button>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Gültig ab (optional)</Label>
                  <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Gültig bis (optional)</Label>
                  <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* ── Step 4: Vorschau ─────────────────────────────────────────── */}
          {step === 4 && productType && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-card p-4 space-y-3">
                <h3 className="font-semibold text-sm">{title || autoTitle}</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Produkt</span>
                    <div className="font-medium">{PRODUCT_LABELS[productType].label}</div>
                  </div>
                  <div>
                    <span className="text-muted-foreground text-xs uppercase tracking-wider">Policy</span>
                    <div className="font-medium">{selectedPolicy?.name ?? '—'}</div>
                  </div>
                  {validFrom && (
                    <div>
                      <span className="text-muted-foreground text-xs uppercase tracking-wider">Gültig ab</span>
                      <div className="font-medium">{validFrom}</div>
                    </div>
                  )}
                  {validUntil && (
                    <div>
                      <span className="text-muted-foreground text-xs uppercase tracking-wider">Gültig bis</span>
                      <div className="font-medium">{validUntil}</div>
                    </div>
                  )}
                </div>

                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-1.5">
                    Wird bereitgestellt ({selectedFields.size} Felder)
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {Array.from(selectedFields).map((f) => (
                      <Badge key={f} variant="secondary" className="text-[10px]">
                        {FIELD_LABELS[f] ?? f}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-muted-foreground text-xs uppercase tracking-wider block mb-1.5">
                    Empfänger ({selectedRecipients.size})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {activeContractors
                      .filter((c) => selectedRecipients.has(c.orgId))
                      .map((c) => (
                        <Badge key={c.orgId} variant="outline" className="text-[10px]">
                          {c.name}
                        </Badge>
                      ))}
                  </div>
                </div>

                <div className="border-t pt-3 mt-1 space-y-0.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <Lock className="h-3 w-3" />
                    Interne Felder bleiben ausschließlich im AG-System.
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Shield className="h-3 w-3" />
                    Empfänger müssen die Nutzungsrichtlinie akzeptieren, bevor sie auf die Daten zugreifen können.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between !flex-row gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => (step === 0 ? handleOpenChange(false) : setStep((s) => s - 1))}
            disabled={isPending}
          >
            {step === 0 ? 'Abbrechen' : (
              <><ChevronLeft className="h-4 w-4 mr-1" /> Zurück</>
            )}
          </Button>
          <div className="flex items-center gap-2">
            {step < 4 ? (
              <Button type="button" onClick={handleNext} disabled={!canNext}>
                Weiter <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handlePublish}
                disabled={isPending || !canNext}
                className="min-w-32"
              >
                {isPending ? (
                  'Wird veröffentlicht…'
                ) : (
                  <><Globe className="h-4 w-4 mr-1.5" /> Veröffentlichen</>
                )}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* ── Policy-Ansicht Dialog (Inhalt + ODRL) ─────────────────────────── */}
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
                Vorschau — Platzhalter werden beim Veröffentlichen durch die tatsächliche Publication-ID und NU-ID ersetzt.
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
