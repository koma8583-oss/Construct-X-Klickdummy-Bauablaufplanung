import { useEffect, useState } from 'react';
import { AlertCircle, Info, Loader2, Send, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/date-picker';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { VergabePartner } from '@/lib/vergabe';

export type LeistungVergabeSubmitValues = {
  recipients: Array<{
    nuOrgId: string;
    parentPolicyId: string;
    parentPolicyVersion: number;
    purpose: LeistungsfreigabePurpose;
    selectedFields: string[];
  }>;
  message?: string;
  responseRequiredBy?: string;
};

type LeistungsfreigabePurpose =
  | 'RAHMENTERMINE'
  | 'LEISTUNGSKOORDINATION'
  | 'AUSFUEHRUNGSINFORMATIONEN'
  | 'INDIVIDUELLE_FREIGABE';

const PURPOSES: Array<{ value: LeistungsfreigabePurpose; label: string }> = [
  { value: 'RAHMENTERMINE', label: 'Rahmentermine abstimmen' },
  { value: 'LEISTUNGSKOORDINATION', label: 'Leistung koordinieren' },
  { value: 'AUSFUEHRUNGSINFORMATIONEN', label: 'Ausführungsinformationen teilen' },
  { value: 'INDIVIDUELLE_FREIGABE', label: 'Individuelle Freigabe' },
];

const PURPOSE_FIELDS: Record<LeistungsfreigabePurpose, string[]> = {
  RAHMENTERMINE: ['trade', 'workPackage', 'kurzbezeichnung', 'location', 'plannedTimeWindow', 'bufferTimeWindow', 'predecessors', 'successors'],
  LEISTUNGSKOORDINATION: ['taktReference', 'taktVersion', 'trade', 'workPackage', 'kurzbezeichnung', 'location', 'plannedTimeWindow', 'bufferTimeWindow', 'requiredOutput', 'resourceRequirements', 'constraints', 'predecessors', 'successors', 'documentReferences'],
  AUSFUEHRUNGSINFORMATIONEN: ['taktReference', 'taktVersion', 'trade', 'workPackage', 'kurzbezeichnung', 'location', 'plannedTimeWindow', 'bufferTimeWindow', 'requiredOutput', 'constraints', 'predecessors', 'successors', 'documentReferences'],
  INDIVIDUELLE_FREIGABE: ['taktReference', 'taktVersion', 'trade', 'workPackage', 'kurzbezeichnung', 'location', 'plannedTimeWindow', 'bufferTimeWindow', 'requiredOutput', 'resourceRequirements', 'constraints', 'predecessors', 'successors', 'documentReferences'],
};

const FIELD_LABELS: Record<string, string> = {
  taktReference: 'Leistungsreferenz', taktVersion: 'Leistungsversion', trade: 'Gewerk',
  workPackage: 'Leistungsbezeichnung', kurzbezeichnung: 'Kurzbezeichnung', location: 'Ausführungsort',
  plannedTimeWindow: 'Geplanter Zeitraum', bufferTimeWindow: 'Terminspielraum',
  requiredOutput: 'Leistungsbeschreibung', resourceRequirements: 'Ressourcenbedarf',
  constraints: 'Randbedingungen', predecessors: 'Vorgänger', successors: 'Nachfolger',
  documentReferences: 'Dokumentreferenzen',
};

type PreviewItem = {
  deltaClass: 'WITHIN_BASELINE' | 'REQUIRES_CONSENT' | 'NOT_PERMITTED';
  error?: string;
  diff?: { summary?: string[] };
};

type RecipientSelection = {
  purpose: LeistungsfreigabePurpose | '';
  selectedFields: string[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partners: VergabePartner[];
  partnersLoading?: boolean;
  partnersError?: boolean;
  taktId: string;
  isSubmitting?: boolean;
  onSubmit: (values: LeistungVergabeSubmitValues) => Promise<void> | void;
};

export function LeistungVergabeDialog({
  open,
  onOpenChange,
  partners,
  partnersLoading = false,
  partnersError = false,
  taktId,
  isSubmitting = false,
  onSubmit,
}: Props) {
  const [selectedNuIds, setSelectedNuIds] = useState<string[]>([]);
  const [recipientSelections, setRecipientSelections] = useState<Record<string, RecipientSelection>>({});
  const [message, setMessage] = useState('');
  const [responseRequiredBy, setResponseRequiredBy] = useState('');
  const [responseRequiredByError, setResponseRequiredByError] = useState('');
  const [preview, setPreview] = useState<Record<string, PreviewItem> | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const selectedPartners = partners.filter((partner) => selectedNuIds.includes(partner.anOrgId));

  const hasExplicitScope = (partner: VergabePartner) => {
    const effectivePolicy = (partner.parentAgreement?.effectivePolicy ?? {}) as Record<string, unknown>;
    return Array.isArray(effectivePolicy.allowedPurposes) &&
      effectivePolicy.allowedPurposes.every((purpose) => typeof purpose === 'string') &&
      Array.isArray(effectivePolicy.allowedFieldScope) &&
      effectivePolicy.allowedFieldScope.every((field) => typeof field === 'string');
  };

  const availablePurposes = (partner: VergabePartner) => PURPOSES.filter((item) => {
    if (!hasExplicitScope(partner)) return false;
    const effectivePolicy = (partner.parentAgreement?.effectivePolicy ?? {}) as Record<string, unknown>;
    return (effectivePolicy.allowedPurposes as string[]).includes(item.value);
  });

  const allowedFields = (partner: VergabePartner, purpose: LeistungsfreigabePurpose | '') => purpose
    ? PURPOSE_FIELDS[purpose].filter((field) => {
      if (!hasExplicitScope(partner)) return false;
      const effectivePolicy = (partner.parentAgreement?.effectivePolicy ?? {}) as Record<string, unknown>;
      return (effectivePolicy.allowedFieldScope as string[]).includes(field);
    })
    : [];

  const selectionFor = (partner: VergabePartner): RecipientSelection =>
    recipientSelections[partner.anOrgId] ?? { purpose: '', selectedFields: [] };

  const updateRecipientSelection = (nuOrgId: string, selection: RecipientSelection) => {
    setRecipientSelections((current) => ({ ...current, [nuOrgId]: selection }));
    setPreview(null);
    setPreviewError('');
  };

  useEffect(() => {
    if (!open) {
      setSelectedNuIds([]);
      setRecipientSelections({});
      setPreview(null);
      setPreviewError('');
      setMessage('');
      setResponseRequiredBy('');
      setResponseRequiredByError('');
      return;
    }
  }, [open]);

  const handleRecipientToggle = (partner: VergabePartner, checked: boolean) => {
    if (checked) {
      const defaults = availablePurposes(partner);
      const purpose = defaults[0]?.value ?? '';
      setSelectedNuIds((current) => [...new Set([...current, partner.anOrgId])]);
      setRecipientSelections((current) => ({
        ...current,
        [partner.anOrgId]: {
          purpose,
          selectedFields: purpose ? allowedFields(partner, purpose) : [],
        },
      }));
    } else {
      setSelectedNuIds((current) => current.filter((id) => id !== partner.anOrgId));
      setRecipientSelections((current) => {
        const next = { ...current };
        delete next[partner.anOrgId];
        return next;
      });
      setPreview(null);
    }
    setPreviewError('');
  };

  const createPreview = async (): Promise<boolean> => {
    if (
      selectedPartners.length === 0 ||
      selectedPartners.some((partner) => {
        const selection = selectionFor(partner);
        return !selection.purpose || selection.selectedFields.length === 0;
      })
    ) return false;
    setPreviewing(true);
    setPreviewError('');
    try {
      const entries = await Promise.all(selectedPartners.map(async (partner) => {
        const parentPolicy = partner.parentAgreement!;
        const selection = selectionFor(partner);
        const response = await fetch('/api/leistungsanfragen/policy-preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            taktIds: [taktId],
            nuOrgId: partner.anOrgId,
            purpose: selection.purpose,
            selectedFields: selection.selectedFields,
            parentPolicyId: parentPolicy.id,
            parentPolicyVersion: parentPolicy.version,
          }),
        });
        const body = await response.json().catch(() => ({})) as { items?: PreviewItem[]; error?: string };
        const item = body.items?.[0];
        if (!response.ok || !item) throw new Error(`${partner.label}: ${body.error || 'Policy-Vorschau konnte nicht erstellt werden.'}`);
        return [partner.anOrgId, item] as const;
      }));
      const items = Object.fromEntries(entries);
      setPreview(items);
      return Object.values(items).every((item) => item.deltaClass !== 'NOT_PERMITTED');
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Policy-Vorschau konnte nicht erstellt werden.');
      return false;
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      selectedPartners.length === 0 ||
      selectedPartners.some((partner) => {
        const selection = selectionFor(partner);
        return !selection.purpose || selection.selectedFields.length === 0;
      })
    ) return;
    if (responseRequiredBy) {
      const deadline = new Date(responseRequiredBy);
      const minimum = new Date(Date.now() + 60 * 60 * 1000);
      if (deadline < minimum) {
        setResponseRequiredByError('Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen.');
        return;
      }
    }
    if (!preview && !(await createPreview())) return;
    if (preview && Object.values(preview).some((item) => item.deltaClass === 'NOT_PERMITTED')) return;
    await onSubmit({
      recipients: selectedPartners.map((partner) => ({
        ...(() => {
          const selection = selectionFor(partner);
          return {
            purpose: selection.purpose as LeistungsfreigabePurpose,
            selectedFields: selection.selectedFields,
          };
        })(),
        nuOrgId: partner.anOrgId,
        parentPolicyId: partner.parentAgreement!.id,
        parentPolicyVersion: partner.parentAgreement!.version,
      })),
      message: message.trim() || undefined,
      responseRequiredBy: responseRequiredBy || undefined,
    });
  };

  const handleDeadlineChange = (value: string) => {
    setResponseRequiredBy(value);
    if (!value) {
      setResponseRequiredByError('');
      return;
    }
    setResponseRequiredByError(
      new Date(value) < new Date(Date.now() + 60 * 60 * 1000)
        ? 'Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen.'
        : '',
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
             Leistungsfreigabe erstellen
          </DialogTitle>
        </DialogHeader>
        <form id="leistung-vergabe-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Nachunternehmen</Label>
            {partnersLoading ? (
              <p className="rounded-md border p-3 text-sm text-muted-foreground">Nachunternehmen werden geladen…</p>
            ) : partnersError ? (
              <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                Die Nachunternehmen konnten nicht geladen werden.
              </p>
            ) : partners.length === 0 ? (
              <p className="flex items-start gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                <Users className="mt-0.5 h-4 w-4 shrink-0" />
                Keine aktiven Nachunternehmen sind diesem Projekt zugeordnet.
              </p>
            ) : (
              <div className="rounded-md border divide-y">
                {partners.map((partner) => (
                  <label key={partner.anOrgId} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-muted/40">
                    <Checkbox
                      checked={selectedNuIds.includes(partner.anOrgId)}
                      disabled={!partner.parentAgreement || !hasExplicitScope(partner)}
                      onCheckedChange={(checked) => handleRecipientToggle(partner, checked === true)}
                    />
                    <span className={!partner.parentAgreement || !hasExplicitScope(partner) ? 'text-muted-foreground' : ''}>
                      {partner.label}
                      {!partner.parentAgreement
                        ? ' · keine akzeptierte Projektvereinbarung'
                        : !hasExplicitScope(partner)
                          ? ' · Policy-Scope muss zuerst backgefüllt werden'
                          : ''}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {selectedNuIds.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selectedNuIds.length} ausgewählt · jede Freigabe wird gegen die konkrete Projektvereinbarung ihres Nachunternehmens geprüft.
              </p>
            )}
          </div>

          {selectedPartners.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Empfängerbezogene Freigaben *</Label>
                <span className="text-xs text-muted-foreground">Zweck und Felder je Empfänger</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Jede Zeile wird mit der akzeptierten Parent-Policy des jeweiligen Nachunternehmens geprüft und versendet.
              </p>
              {selectedPartners.map((partner) => {
                const selection = selectionFor(partner);
                const recipientPurposes = availablePurposes(partner);
                const recipientFields = allowedFields(partner, selection.purpose);
                const recipientPreview = preview?.[partner.anOrgId];
                return (
                  <div key={partner.anOrgId} className="space-y-3 rounded-md border p-3" data-testid={`recipient-config-${partner.anOrgId}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{partner.label}</p>
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Info className="h-3 w-3" />
                          Parent-Policy: {partner.parentAgreement?.id} · Version {partner.parentAgreement?.version}
                        </p>
                      </div>
                      {recipientPreview && (
                        <span className={recipientPreview.deltaClass === 'NOT_PERMITTED' ? 'text-xs text-destructive' : 'text-xs text-emerald-700'}>
                          {recipientPreview.deltaClass}
                        </span>
                      )}
                    </div>
                    {recipientPurposes.length === 0 ? (
                      <p className="text-sm text-destructive">
                        {!hasExplicitScope(partner)
                          ? 'Diese Parent-Policy enthält noch keinen expliziten Zweck- und Datenfeldumfang.'
                          : 'Diese Parent-Policy erlaubt keinen unterstützten Leistungszweck.'}
                      </p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor={`purpose-${partner.anOrgId}`}>Fachlicher Zweck *</Label>
                          <Select
                            value={selection.purpose}
                            onValueChange={(value) => {
                              const purpose = value as LeistungsfreigabePurpose;
                              updateRecipientSelection(partner.anOrgId, {
                                purpose,
                                selectedFields: allowedFields(partner, purpose),
                              });
                            }}
                          >
                            <SelectTrigger id={`purpose-${partner.anOrgId}`} aria-label={`Fachlicher Zweck für ${partner.label}`}>
                              <SelectValue placeholder="Zweck auswählen…" />
                            </SelectTrigger>
                            <SelectContent>
                              {recipientPurposes.map((item) => (
                                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>Freizugebende Leistungsdaten *</Label>
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline"
                              onClick={() => updateRecipientSelection(partner.anOrgId, {
                                ...selection,
                                selectedFields: selection.selectedFields.length === recipientFields.length ? [] : [...recipientFields],
                              })}
                            >
                              {selection.selectedFields.length === recipientFields.length ? 'Alle abwählen' : 'Alle wählen'}
                            </button>
                          </div>
                          <div className="rounded-md border overflow-hidden">
                            <div className="grid grid-cols-2 gap-x-3 px-3 py-2">
                              {recipientFields.map((field) => (
                                <label key={field} className="flex items-center gap-2 py-1 text-sm">
                                  <Checkbox
                                    checked={selection.selectedFields.includes(field)}
                                    onCheckedChange={(checked) => updateRecipientSelection(partner.anOrgId, {
                                      ...selection,
                                      selectedFields: checked
                                        ? [...new Set([...selection.selectedFields, field])]
                                        : selection.selectedFields.filter((item) => item !== field),
                                    })}
                                  />
                                  <span>{FIELD_LABELS[field] ?? field}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                          {selection.selectedFields.length === 0 && (
                            <p className="flex items-center gap-1 text-xs text-destructive">
                              <AlertCircle className="h-3 w-3" /> Mindestens ein Datenfeld muss freigegeben werden.
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={createPreview} disabled={previewing}>
                  {previewing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Vorschau prüfen
                </Button>
              </div>
              {preview && (
                <div className="space-y-1 rounded-md border p-3 text-sm" data-testid="policy-preview">
                  <p className={Object.values(preview).some((item) => item.deltaClass === 'NOT_PERMITTED') ? 'text-destructive' : 'text-emerald-700'}>
                    {Object.values(preview).every((item) => item.deltaClass === 'WITHIN_BASELINE')
                      ? 'WITHIN_BASELINE'
                      : `${Object.keys(preview).length} Parent-Policies geprüft`}
                  </p>
                  {Object.entries(preview).flatMap(([nuOrgId, item]) =>
                    (item.diff?.summary ?? []).map((summary, index) => (
                      <p key={`${nuOrgId}-${summary}-${index}`} className="text-xs text-muted-foreground">{summary}</p>
                    )),
                  )}
                </div>
              )}
              {previewError && <p className="text-xs text-destructive">{previewError}</p>}
            </div>
          )}

          <Textarea
            name="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Hinweis (optional)"
            className="resize-none"
          />
          <div className="space-y-2">
            <Label>Antwortfrist <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <DatePicker
              includeTime
              value={responseRequiredBy}
              min={new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16)}
              onChange={handleDeadlineChange}
            />
            {responseRequiredByError && (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                {responseRequiredByError}
              </p>
            )}
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button
            type="submit"
            form="leistung-vergabe-form"
              disabled={
                isSubmitting ||
                previewing ||
                selectedPartners.length === 0 ||
                selectedPartners.some((partner) => {
                  const selection = selectionFor(partner);
                  return !selection.purpose || selection.selectedFields.length === 0;
                }) ||
                (preview != null && Object.values(preview).some((item) => item.deltaClass === 'NOT_PERMITTED')) ||
                !!responseRequiredByError
              }
          >
            <Send className="mr-2 h-4 w-4" />
            {isSubmitting ? 'Vergabe läuft…' : 'Vergeben'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}