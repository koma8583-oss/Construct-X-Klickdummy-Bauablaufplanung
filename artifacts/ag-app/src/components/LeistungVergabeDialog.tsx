import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Info, Send, Users } from 'lucide-react';
import type { DataPublication } from '@workspace/api-client-react';
import type { PolicyTemplateRegistryEntry } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/date-picker';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { getEligibleVergabePublications, type VergabePartner } from '@/lib/vergabe';

export type LeistungVergabeSubmitValues = {
  nuOrgIds: string[];
  dataPublicationId: string;
  message?: string;
  responseRequiredBy?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taktId: string;
  partners: VergabePartner[];
  partnersLoading?: boolean;
  partnersError?: boolean;
  publications?: DataPublication[];
  publicationsLoading?: boolean;
  publicationsError?: boolean;
  policies?: PolicyTemplateRegistryEntry[];
  policiesLoading?: boolean;
  policiesError?: boolean;
  isSubmitting?: boolean;
  onSubmit: (values: LeistungVergabeSubmitValues) => Promise<void> | void;
  onCreatePublication?: () => void;
};

function resetDateValue() {
  return '';
}

export function LeistungVergabeDialog({
  open,
  onOpenChange,
  taktId,
  partners,
  partnersLoading = false,
  partnersError = false,
  publications = [],
  publicationsLoading = false,
  publicationsError = false,
  policies = [],
  policiesLoading = false,
  policiesError = false,
  isSubmitting = false,
  onSubmit,
  onCreatePublication,
}: Props) {
  const [selectedNuIds, setSelectedNuIds] = useState<string[]>([]);
  const [selectedPolicyKey, setSelectedPolicyKey] = useState('');
  const [publicationId, setPublicationId] = useState('');
  const [message, setMessage] = useState('');
  const [responseRequiredBy, setResponseRequiredBy] = useState('');
  const [responseRequiredByError, setResponseRequiredByError] = useState('');

  const schedulePolicies = useMemo(
    () => policies
      .filter((policy) => policy.code === 'SCHEDULE_COORDINATION')
      .sort((a, b) => b.version - a.version),
    [policies],
  );
  const selectedPolicy = schedulePolicies.find(
    (policy) => `${policy.code}:${policy.version}` === selectedPolicyKey,
  );
  const eligiblePublications = useMemo(
    () => getEligibleVergabePublications(
      publications,
      taktId,
      selectedNuIds,
      selectedPolicy
        ? {
            templateId: selectedPolicy.templateId,
            code: selectedPolicy.code,
            version: selectedPolicy.version,
          }
        : undefined,
    ),
    [publications, selectedNuIds, selectedPolicy, taktId],
  );

  useEffect(() => {
    if (!open) {
      setSelectedNuIds([]);
      setSelectedPolicyKey('');
      setPublicationId('');
      setMessage('');
      setResponseRequiredBy(resetDateValue());
      setResponseRequiredByError('');
      return;
    }
    if (schedulePolicies[0] && (!selectedPolicyKey || !selectedPolicy)) {
      setSelectedPolicyKey(`${schedulePolicies[0].code}:${schedulePolicies[0].version}`);
    }
  }, [open, schedulePolicies, selectedPolicy, selectedPolicyKey]);

  useEffect(() => {
    if (publicationId && !eligiblePublications.some((publication) => publication.id === publicationId)) {
      setPublicationId('');
    }
  }, [eligiblePublications, publicationId]);

  const toggleNu = (anOrgId: string) => {
    setSelectedNuIds((current) => {
      const next = current.includes(anOrgId)
        ? current.filter((id) => id !== anOrgId)
        : [...current, anOrgId];
      setPublicationId('');
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedNuIds.length === 0 || !selectedPolicy || !publicationId) return;
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
      dataPublicationId: publicationId,
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

  const publicationMessage = selectedNuIds.length === 0
    ? 'Wählen Sie zuerst mindestens einen Nachunternehmer aus.'
    : publicationsLoading
      ? 'Veröffentlichungen werden geladen…'
      : publicationsError
        ? 'Die Veröffentlichungen konnten nicht geladen werden. Bitte versuchen Sie es erneut.'
        : eligiblePublications.length === 0
          ? 'Keine veröffentlichte Leistungsinformation passt zu allen ausgewählten Nachunternehmen und der ausgewählten Policy.'
          : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="h-5 w-5 text-primary" />
            Leistung vergeben
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
            <Label>Rahmentermin-Policy *</Label>
            {policiesLoading ? (
              <p className="text-sm text-muted-foreground">Policies werden geladen…</p>
            ) : policiesError ? (
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                Die Rahmentermin-Policies konnten nicht geladen werden.
              </p>
            ) : schedulePolicies.length === 0 ? (
              <p className="text-sm text-destructive">Keine gültige Rahmentermin-Policy ist verfügbar.</p>
            ) : (
              <>
                <Select
                  value={selectedPolicyKey}
                  onValueChange={(value) => {
                    setSelectedPolicyKey(value);
                    setPublicationId('');
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Policy auswählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    {schedulePolicies.map((policy) => (
                      <SelectItem key={`${policy.code}-${policy.version}`} value={`${policy.code}:${policy.version}`}>
                        {policy.name} · v{policy.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Nur Veröffentlichungen mit dieser Rahmentermin-Policy und Version werden angeboten.
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label>Veröffentlichte Leistungsinformationen *</Label>
            {publicationMessage ? (
              <div className="space-y-2">
                <p className="rounded-md border border-border/60 bg-muted/20 p-2.5 text-xs text-muted-foreground">
                  {publicationMessage}
                </p>
                {selectedNuIds.length > 0 && !publicationsLoading && !publicationsError &&
                  eligiblePublications.length === 0 && onCreatePublication && (
                    <Button type="button" variant="outline" size="sm" onClick={onCreatePublication}>
                      Datenraum-Veröffentlichung erstellen
                    </Button>
                  )}
              </div>
            ) : (
              <Select value={publicationId} onValueChange={setPublicationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Veröffentlichung auswählen…" />
                </SelectTrigger>
                <SelectContent>
                  {eligiblePublications.map((publication) => (
                    <SelectItem key={publication.id} value={publication.id}>
                      {publication.title} · Version {publication.version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            disabled={isSubmitting || selectedNuIds.length === 0 || !selectedPolicy || !publicationId || !!responseRequiredByError}
          >
            <Send className="mr-2 h-4 w-4" />
            {isSubmitting ? 'Vergabe läuft…' : 'Vergeben'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}