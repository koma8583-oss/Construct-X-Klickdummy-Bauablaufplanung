import { useEffect, useMemo, useState } from 'react';
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
  nuOrgIds: string[];
  purpose: LeistungsfreigabePurpose;
  selectedFields: string[];
  parentPolicyId: string;
  parentPolicyVersion: number;
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
  const [selectedNuId, setSelectedNuId] = useState('');
  const [purpose, setPurpose] = useState<LeistungsfreigabePurpose | ''>('');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [responseRequiredBy, setResponseRequiredBy] = useState('');
  const [responseRequiredByError, setResponseRequiredByError] = useState('');
  const [preview, setPreview] = useState<PreviewItem | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const selectedPartner = partners.find((partner) => partner.anOrgId === selectedNuId);
  const parentPolicy = selectedPartner?.parentAgreement;
  const effectivePolicy = (parentPolicy?.effectivePolicy ?? {}) as Record<string, unknown>;
  const parentPurposes = Array.isArray(effectivePolicy.allowedPurposes)
    ? effectivePolicy.allowedPurposes.filter((value): value is string => typeof value === 'string')
    : PURPOSES.map((item) => item.value);
  const availablePurposes = PURPOSES.filter((item) => parentPurposes.includes(item.value));
  const parentFieldScope = Array.isArray(effectivePolicy.allowedFieldScope)
    ? effectivePolicy.allowedFieldScope.filter((value): value is string => typeof value === 'string')
    : null;
  const allowedFields = useMemo(() => purpose
    ? PURPOSE_FIELDS[purpose].filter((field) => !parentFieldScope || parentFieldScope.includes(field))
    : [], [purpose, parentFieldScope]);

  useEffect(() => {
    if (!open) {
      setSelectedNuId('');
      setPurpose('');
      setSelectedFields([]);
      setPreview(null);
      setPreviewError('');
      setMessage('');
      setResponseRequiredBy('');
      setResponseRequiredByError('');
      return;
    }
  }, [open]);

  useEffect(() => {
    setPurpose('');
    setSelectedFields([]);
    setPreview(null);
    setPreviewError('');
  }, [selectedNuId]);

  useEffect(() => {
    setSelectedFields([...allowedFields]);
    setPreview(null);
    setPreviewError('');
  }, [purpose]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setPreview(null);
    setPreviewError('');
  }, [selectedFields, parentPolicy?.id, parentPolicy?.version]);

  const createPreview = async (): Promise<boolean> => {
    if (!selectedNuId || !purpose || !parentPolicy || selectedFields.length === 0) return false;
    setPreviewing(true);
    setPreviewError('');
    try {
      const response = await fetch('/api/leistungsanfragen/policy-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          taktIds: [taktId],
          nuOrgId: selectedNuId,
          purpose,
          selectedFields,
          parentPolicyId: parentPolicy.id,
          parentPolicyVersion: parentPolicy.version,
        }),
      });
      const body = await response.json().catch(() => ({})) as { items?: PreviewItem[]; error?: string };
      const item = body.items?.[0];
      if (!response.ok || !item) throw new Error(body.error || 'Policy-Vorschau konnte nicht erstellt werden.');
      setPreview(item);
      return item.deltaClass !== 'NOT_PERMITTED';
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Policy-Vorschau konnte nicht erstellt werden.');
      return false;
    } finally {
      setPreviewing(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedNuId || !purpose || !parentPolicy || selectedFields.length === 0) return;
    if (responseRequiredBy) {
      const deadline = new Date(responseRequiredBy);
      const minimum = new Date(Date.now() + 60 * 60 * 1000);
      if (deadline < minimum) {
        setResponseRequiredByError('Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen.');
        return;
      }
    }
    if (!preview && !(await createPreview())) return;
    if (preview?.deltaClass === 'NOT_PERMITTED') return;
    await onSubmit({
      nuOrgIds: [selectedNuId],
      purpose,
      selectedFields,
      parentPolicyId: parentPolicy.id,
      parentPolicyVersion: parentPolicy.version,
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
                      checked={selectedNuId === partner.anOrgId}
                      disabled={!partner.parentAgreement}
                      onCheckedChange={() => setSelectedNuId(selectedNuId === partner.anOrgId ? '' : partner.anOrgId)}
                    />
                    <span className={!partner.parentAgreement ? 'text-muted-foreground' : ''}>
                      {partner.label}{!partner.parentAgreement ? ' · keine akzeptierte Projektvereinbarung' : ''}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {selectedNuId && (
              <p className="text-xs text-muted-foreground">Die Freigabe wird gegen die konkrete Projektvereinbarung dieses Nachunternehmens geprüft.</p>
            )}
          </div>

          <div className="space-y-2">
             <Label>Fachlicher Zweck *</Label>
            {!selectedNuId ? (
              <p className="text-sm text-muted-foreground">Bitte zuerst ein Nachunternehmen auswählen.</p>
            ) : availablePurposes.length === 0 ? (
             <p className="text-sm text-destructive">Die akzeptierte Projektvereinbarung erlaubt keinen unterstützten Leistungszweck.</p>
            ) : (
              <>
                <Select
                  value={purpose}
                  onValueChange={(value) => setPurpose(value as LeistungsfreigabePurpose)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Policy auswählen…" />
                  </SelectTrigger>
                  <SelectContent>
                     {availablePurposes.map((item) => (
                       <SelectItem key={item.value} value={item.value}>
                         {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                    Parent-Policy: {parentPolicy?.id} · Version {parentPolicy?.version}
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
             <div className="flex items-center justify-between">
             <Label>Freizugebende Leistungsdaten *</Label>
               <button
                 type="button"
                 className="text-xs text-primary hover:underline"
                 onClick={() => setSelectedFields(
                   selectedFields.length === allowedFields.length ? [] : [...allowedFields],
                 )}
               >
                 {selectedFields.length === allowedFields.length ? 'Alle abwählen' : 'Alle wählen'}
               </button>
             </div>
             <p className="text-xs text-muted-foreground">
               Die Auswahl betrifft nur die Leistungsfreigabe. Interne Angaben wie Kosten, Risiko, Priorität und Notizen bleiben immer ausgeschlossen.
             </p>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {purpose && allowedFields.length === 0 ? (
                  <p className="text-sm text-destructive">Für diesen Zweck erlaubt die Parent-Policy keine freigebbaren Leistungsfelder.</p>
                ) : (
                  <div className="rounded-md border overflow-hidden">
                    <div className="grid grid-cols-2 gap-x-3 px-3 py-2">
                      {allowedFields.map((field) => (
                       <label key={field} className="flex items-center gap-2 py-1 text-sm">
                         <Checkbox
                           checked={selectedFields.includes(field)}
                           onCheckedChange={(checked) => setSelectedFields((current) => (
                             checked
                               ? [...new Set([...current, field])]
                               : current.filter((item) => item !== field)
                           ))}
                         />
                         <span>{FIELD_LABELS[field] ?? field}</span>
                       </label>
                     ))}
                    </div>
                  </div>
                )}
             </div>
             {selectedFields.length === 0 && (
               <p className="flex items-center gap-1 text-xs text-destructive">
                 <AlertCircle className="h-3 w-3" /> Mindestens ein Datenfeld muss freigegeben werden.
               </p>
             )}
          </div>
          {purpose && selectedFields.length > 0 && (
            <div className="space-y-2 rounded-md border p-3 text-sm" data-testid="policy-preview">
              <div className="flex items-center justify-between">
                <span className="font-medium">Konkrete Child-Policy</span>
                <Button type="button" size="sm" variant="outline" onClick={createPreview} disabled={previewing}>
                  {previewing && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                  Vorschau prüfen
                </Button>
              </div>
              {preview && <p className={preview.deltaClass === 'NOT_PERMITTED' ? 'text-destructive' : 'text-emerald-700'}>{preview.deltaClass}</p>}
              {preview?.diff?.summary?.map((summary) => <p key={summary} className="text-xs text-muted-foreground">{summary}</p>)}
              {(preview?.error || previewError) && <p className="text-xs text-destructive">{preview?.error || previewError}</p>}
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
             disabled={isSubmitting || previewing || !selectedNuId || !purpose || !parentPolicy || selectedFields.length === 0 || preview?.deltaClass === 'NOT_PERMITTED' || !!responseRequiredByError}
          >
            <Send className="mr-2 h-4 w-4" />
            {isSubmitting ? 'Vergabe läuft…' : 'Vergeben'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}