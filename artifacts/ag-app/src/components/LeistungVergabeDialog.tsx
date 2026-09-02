import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Info, Send, Users } from 'lucide-react';
import {
  FIELD_GROUPS,
  FIELD_LABELS,
  FIELD_WHITELISTS,
  type PolicyTemplateRegistryEntry,
} from '@workspace/api-client-react';
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
  policyTemplateId: string;
  selectedFields: string[];
  message?: string;
  responseRequiredBy?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partners: VergabePartner[];
  partnersLoading?: boolean;
  partnersError?: boolean;
  policies?: PolicyTemplateRegistryEntry[];
  policiesLoading?: boolean;
  policiesError?: boolean;
  isSubmitting?: boolean;
  onSubmit: (values: LeistungVergabeSubmitValues) => Promise<void> | void;
};

export function LeistungVergabeDialog({
  open,
  onOpenChange,
  partners,
  partnersLoading = false,
  partnersError = false,
  policies = [],
  policiesLoading = false,
  policiesError = false,
  isSubmitting = false,
  onSubmit,
}: Props) {
  const [selectedNuIds, setSelectedNuIds] = useState<string[]>([]);
  const [selectedPolicyKey, setSelectedPolicyKey] = useState('');
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [responseRequiredBy, setResponseRequiredBy] = useState('');
  const [responseRequiredByError, setResponseRequiredByError] = useState('');
  const previousPolicyKey = useRef('');

  const performancePolicies = useMemo(
    () => policies
      .filter((policy) => policy.code === 'PERFORMANCE_COORDINATION')
      .sort((a, b) => b.version - a.version),
    [policies],
  );
  const selectedPolicy = performancePolicies.find(
    (policy) => `${policy.code}:${policy.version}` === selectedPolicyKey,
  );
  const allowedFields = selectedPolicy?.allowedPublicationFields
    ?? FIELD_WHITELISTS.TAKT_INFORMATION_PACKAGE;
  const allowedFieldSet = useMemo(() => new Set(allowedFields), [allowedFields]);
  const visibleFieldGroups = useMemo(
    () => (FIELD_GROUPS.TAKT_INFORMATION_PACKAGE ?? [])
      .map((group) => ({
        ...group,
        fields: group.fields.filter((field) => allowedFieldSet.has(field)),
      }))
      .filter((group) => group.fields.length > 0),
    [allowedFieldSet],
  );

  useEffect(() => {
    if (!open) {
      setSelectedNuIds([]);
      setSelectedPolicyKey('');
      setSelectedFields([]);
      previousPolicyKey.current = '';
      setMessage('');
      setResponseRequiredBy('');
      setResponseRequiredByError('');
      return;
    }
    if (performancePolicies[0] && (!selectedPolicyKey || !selectedPolicy)) {
      setSelectedPolicyKey(`${performancePolicies[0].code}:${performancePolicies[0].version}`);
    }
    if (selectedPolicy && previousPolicyKey.current !== selectedPolicyKey) {
      setSelectedFields([...allowedFields]);
      previousPolicyKey.current = selectedPolicyKey;
    }
  }, [open, performancePolicies, selectedPolicy, selectedPolicyKey, allowedFields, allowedFieldSet]);

  const toggleNu = (anOrgId: string) => {
    setSelectedNuIds((current) => {
      const next = current.includes(anOrgId)
        ? current.filter((id) => id !== anOrgId)
        : [...current, anOrgId];
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedNuIds.length === 0 || !selectedPolicy || selectedFields.length === 0) return;
    if (responseRequiredBy) {
      const deadline = new Date(responseRequiredBy);
      const minimum = new Date(Date.now() + 60 * 60 * 1000);
      if (deadline < minimum) {
        setResponseRequiredByError('Die Antwortfrist muss mindestens 1 Stunde in der Zukunft liegen.');
        return;
      }
    }
    await onSubmit({
      nuOrgIds: selectedNuIds,
      policyTemplateId: selectedPolicy.templateId,
      selectedFields,
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
                      onCheckedChange={() => toggleNu(partner.anOrgId)}
                    />
                    <span>{partner.label}</span>
                  </label>
                ))}
              </div>
            )}
            {selectedNuIds.length > 0 && (
              <p className="text-xs text-muted-foreground">{selectedNuIds.length} Nachunternehmen ausgewählt</p>
            )}
          </div>

          <div className="space-y-2">
             <Label>Leistungsfreigabe-Policy *</Label>
            {policiesLoading ? (
              <p className="text-sm text-muted-foreground">Policies werden geladen…</p>
            ) : policiesError ? (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                 Die Leistungsfreigabe-Policies konnten nicht geladen werden.
              </p>
            ) : performancePolicies.length === 0 ? (
             <p className="text-sm text-destructive">Keine gültige Leistungsfreigabe-Policy ist verfügbar.</p>
            ) : (
              <>
                <Select
                  value={selectedPolicyKey}
                  onValueChange={(value) => {
                    setSelectedPolicyKey(value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Policy auswählen…" />
                  </SelectTrigger>
                  <SelectContent>
                     {performancePolicies.map((policy) => (
                      <SelectItem key={`${policy.code}-${policy.version}`} value={`${policy.code}:${policy.version}`}>
                        {policy.name} · v{policy.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                   Diese Policy ergänzt die akzeptierte Projektmitgliedschafts-Policy und gilt nur für die konkret vergebene Leistung.
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
               {visibleFieldGroups.map((group) => (
                 <div key={group.label} className="rounded-md border overflow-hidden">
                   <div className="flex items-center justify-between bg-muted/30 px-3 py-2">
                     <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</span>
                     <span className="text-[10px] text-primary">
                       {group.fields.filter((field) => selectedFields.includes(field)).length}/{group.fields.length}
                     </span>
                   </div>
                   <div className="grid grid-cols-2 gap-x-3 px-3 py-2">
                     {group.fields.map((field) => (
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
               ))}
             </div>
             {selectedFields.length === 0 && (
               <p className="flex items-center gap-1 text-xs text-destructive">
                 <AlertCircle className="h-3 w-3" /> Mindestens ein Datenfeld muss freigegeben werden.
               </p>
             )}
          </div>

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
             disabled={isSubmitting || selectedNuIds.length === 0 || !selectedPolicy || selectedFields.length === 0 || !!responseRequiredByError}
          >
            <Send className="mr-2 h-4 w-4" />
            {isSubmitting ? 'Vergabe läuft…' : 'Vergeben'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}