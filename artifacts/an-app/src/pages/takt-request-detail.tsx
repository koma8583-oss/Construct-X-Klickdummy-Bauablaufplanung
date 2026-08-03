/**
 * TaktRequest detail page for AN users.
 * Shows snapshot data, allows availability check, and response submission.
 * Route: /takt-requests/:requestId
 */
import React, { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  useGetTaktRequestDetails,
  useSubmitNuResponse,
  useRunAvailabilityCheck,
  getGetTaktRequestDetailsQueryKey,
  TaktDecision,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  DRAFT:                 'Entwurf',
  SENT:                  'Gesendet',
  DELIVERED:             'Zugestellt',
  DETAILS_RETRIEVED:     'Details abgerufen',
  UNDER_REVIEW:          'In Prüfung',
  ACCEPTED:              'Angenommen',
  ALTERNATIVES_PROPOSED: 'Gegenvorschlag eingereicht',
  REJECTED:              'Abgelehnt',
  EXPIRED:               'Abgelaufen',
};

const REASON_CODES = [
  { value: 'RESOURCE_CONFLICT',     label: 'Ressourcenkonflikt' },
  { value: 'NO_CAPACITY',           label: 'Keine Kapazität' },
  { value: 'QUALIFICATION_MISSING', label: 'Qualifikation fehlt' },
  { value: 'OTHER',                 label: 'Sonstiges' },
];

function canRespond(status: string): boolean {
  return ['DELIVERED', 'DETAILS_RETRIEVED', 'UNDER_REVIEW'].includes(status);
}

function fmtDate(s?: string | null): string {
  if (!s) return '—';
  try { return format(new Date(s), 'dd.MM.yyyy', { locale: de }); } catch { return s; }
}
function fmtDateTime(s?: string | null): string {
  if (!s) return '—';
  try { return format(new Date(s), 'dd.MM.yyyy HH:mm', { locale: de }); } catch { return s; }
}

// ── Alternative form row ───────────────────────────────────────────────────────

interface AltRow { start: string; end: string; }

// ── Main component ─────────────────────────────────────────────────────────────

export default function TaktRequestDetailPage() {
  const { requestId } = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form state
  const [decision, setDecision] = useState('');
  const [acceptStart, setAcceptStart] = useState('');
  const [acceptEnd, setAcceptEnd]     = useState('');
  const [alternatives, setAlternatives] = useState<AltRow[]>([{ start: '', end: '' }]);
  const [reasonCode, setReasonCode]   = useState('');
  const [comment, setComment]         = useState('');

  // Data queries
  const { data: details, isLoading, isError, refetch } = useGetTaktRequestDetails(requestId!, {
    query: { enabled: !!requestId, queryKey: getGetTaktRequestDetailsQueryKey(requestId!) },
  });

  const runCheck      = useRunAvailabilityCheck();
  const submitResponse = useSubmitNuResponse();

  // Snapshot payload (shape defined in docs/json-contracts.md)
  const snap = details?.snapshotPayload as Record<string, unknown> | undefined;
  const snapStart    = snap?.plannedStart as string | undefined;
  const snapEnd      = snap?.plannedEnd   as string | undefined;
  const snapBez      = snap?.taktBezeichnung as string | undefined;
  const snapZone     = snap?.zone         as string | undefined;
  const snapGewerk   = snap?.gewerk       as string | undefined;
  const snapDesc     = snap?.description  as string | undefined;

  const handleDecisionChange = (val: string) => {
    setDecision(val);
    // Pre-fill accepted window from snapshot
    if (val === TaktDecision.ACCEPTED && snapStart && !acceptStart) {
      setAcceptStart(snapStart.substring(0, 10));
      setAcceptEnd((snapEnd ?? '').substring(0, 10));
    }
  };

  const handleRunCheck = () => {
    runCheck.mutate({ requestId: requestId! }, {
      onSuccess: () => toast({ title: 'Verfügbarkeitsprüfung gestartet' }),
      onError:   (err) => toast({ title: 'Fehler', description: (err as Error).message, variant: 'destructive' }),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!decision) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = { decision };

    if (decision === TaktDecision.ACCEPTED) {
      payload.acceptedTimeWindow = { start: acceptStart, end: acceptEnd };
    } else if (decision === TaktDecision.ALTERNATIVES_PROPOSED) {
      payload.alternatives = alternatives.map((a, i) => ({
        rank: i + 1,
        timeWindow: { start: a.start, end: a.end },
      }));
    } else if (decision === TaktDecision.REJECTED) {
      if (reasonCode) payload.reasonCode = reasonCode;
      if (comment)    payload.comment    = comment;
    }

    submitResponse.mutate({ requestId: requestId!, data: payload }, {
      onSuccess: () => {
        toast({ title: 'Antwort eingereicht' });
        queryClient.invalidateQueries({ queryKey: getGetTaktRequestDetailsQueryKey(requestId!) });
        // Reset form
        setDecision('');
        setAcceptStart('');
        setAcceptEnd('');
        setAlternatives([{ start: '', end: '' }]);
        setReasonCode('');
        setComment('');
      },
      onError: (err) => toast({ title: 'Fehler beim Einreichen', description: (err as Error).message, variant: 'destructive' }),
    });
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex items-center gap-3 py-20">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="text-muted-foreground">Lade Anfrage…</span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (isError || !details) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex flex-col items-center gap-4 py-20">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">Anfrage konnte nicht geladen werden</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Erneut versuchen
        </Button>
      </div>
    );
  }

  const respond   = canRespond(details.status);
  const isExpired = details.status === 'EXPIRED';
  const hasResponded = ['ACCEPTED', 'ALTERNATIVES_PROPOSED', 'REJECTED'].includes(details.status);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">

      {/* Back navigation */}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 -ml-2 text-muted-foreground"
        onClick={() => setLocation('/takt-requests')}
      >
        <ArrowLeft className="w-4 h-4" />
        Zurück zu Anfragen
      </Button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{snapBez ?? 'TaktAnfrage'}</h1>
          <p className="text-muted-foreground font-mono text-sm mt-0.5">{details.requestNumber}</p>
        </div>
        <Badge variant={isExpired ? 'outline' : hasResponded ? 'secondary' : 'default'}>
          {STATUS_LABELS[details.status] ?? details.status}
        </Badge>
      </div>

      {/* Deadline banner */}
      {details.responseRequiredBy && (
        <div
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm ${
            isExpired
              ? 'border-red-500/40 bg-red-500/8 text-red-600 dark:text-red-400'
              : 'border-amber-500/40 bg-amber-500/8 text-amber-700 dark:text-amber-400'
          }`}
        >
          <Clock className="w-4 h-4 shrink-0" />
          <span>
            {isExpired ? 'Antwortfrist abgelaufen: ' : 'Antwortfrist: '}
            <strong>{fmtDateTime(details.responseRequiredBy)}</strong>
          </span>
        </div>
      )}

      {/* Snapshot details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Taktdaten (Stand der Anfrage)
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Taktbezeichnung</div>
            <div className="font-medium">{snapBez ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Gewerk</div>
            <div className="font-medium">{snapGewerk ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Zone</div>
            <div className="font-medium">{snapZone ?? '—'}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Taktversion</div>
            <div className="font-medium">v{details.taktVersion}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Geplanter Start</div>
            <div className="font-medium flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 opacity-50" />
              {fmtDate(snapStart)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Geplantes Ende</div>
            <div className="font-medium flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 opacity-50" />
              {fmtDate(snapEnd)}
            </div>
          </div>
          {snapDesc && (
            <div className="col-span-2">
              <div className="text-xs text-muted-foreground mb-0.5">Beschreibung</div>
              <div className="text-sm text-foreground/80">{snapDesc}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Availability check */}
      {respond && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Verfügbarkeitsprüfung
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              Prüfen Sie intern die Ressourcenverfügbarkeit für diesen Takt, bevor Sie antworten.
            </p>
            <Button variant="outline" onClick={handleRunCheck} disabled={runCheck.isPending}>
              {runCheck.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Prüfung läuft…</>
              ) : (
                'Verfügbarkeit prüfen'
              )}
            </Button>
            {runCheck.isSuccess && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-2">
                Prüfung abgeschlossen. Internes Ergebnis gespeichert.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Response form */}
      {respond && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Antwort einreichen
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-5">

              {/* Decision selector */}
              <div className="space-y-2">
                <Label>Entscheidung</Label>
                <Select value={decision} onValueChange={handleDecisionChange} required>
                  <SelectTrigger>
                    <SelectValue placeholder="Entscheidung wählen…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TaktDecision.ACCEPTED}>Termin annehmen</SelectItem>
                    <SelectItem value={TaktDecision.ALTERNATIVES_PROPOSED}>Gegenvorschlag einreichen</SelectItem>
                    <SelectItem value={TaktDecision.REJECTED}>Ablehnen</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* ACCEPTED — confirm window */}
              {decision === TaktDecision.ACCEPTED && (
                <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Bestätigter Start</Label>
                    <Input
                      type="date"
                      value={acceptStart}
                      onChange={e => setAcceptStart(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Bestätigtes Ende</Label>
                    <Input
                      type="date"
                      value={acceptEnd}
                      onChange={e => setAcceptEnd(e.target.value)}
                      required
                    />
                  </div>
                </div>
              )}

              {/* ALTERNATIVES_PROPOSED */}
              {decision === TaktDecision.ALTERNATIVES_PROPOSED && (
                <div className="space-y-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Alternativtermine (bis zu 3)</span>
                    {alternatives.length < 3 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setAlternatives(prev => [...prev, { start: '', end: '' }])}
                      >
                        <Plus className="w-3.5 h-3.5 mr-1" />
                        Hinzufügen
                      </Button>
                    )}
                  </div>
                  {alternatives.map((alt, idx) => (
                    <div key={idx} className="flex items-end gap-2">
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Alternative {idx + 1} — Start</Label>
                        <Input
                          type="date"
                          value={alt.start}
                          onChange={e =>
                            setAlternatives(prev =>
                              prev.map((a, i) => i === idx ? { ...a, start: e.target.value } : a)
                            )
                          }
                          required
                        />
                      </div>
                      <div className="flex-1 space-y-1">
                        <Label className="text-xs">Ende</Label>
                        <Input
                          type="date"
                          value={alt.end}
                          onChange={e =>
                            setAlternatives(prev =>
                              prev.map((a, i) => i === idx ? { ...a, end: e.target.value } : a)
                            )
                          }
                          required
                        />
                      </div>
                      {alternatives.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-muted-foreground hover:text-red-500"
                          onClick={() => setAlternatives(prev => prev.filter((_, i) => i !== idx))}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* REJECTED */}
              {decision === TaktDecision.REJECTED && (
                <div className="space-y-3 p-4 rounded-lg bg-red-500/5 border border-red-500/20">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Ablehnungsgrund (optional)</Label>
                    <Select value={reasonCode} onValueChange={setReasonCode}>
                      <SelectTrigger>
                        <SelectValue placeholder="Grund wählen…" />
                      </SelectTrigger>
                      <SelectContent>
                        {REASON_CODES.map(r => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Kommentar (optional, intern)</Label>
                    <Textarea
                      value={comment}
                      onChange={e => setComment(e.target.value)}
                      placeholder="Interner Hinweis (wird nicht übermittelt)"
                      className="h-20 resize-none"
                      maxLength={500}
                    />
                  </div>
                </div>
              )}

              {decision && (
                <Button type="submit" className="w-full" disabled={submitResponse.isPending}>
                  {submitResponse.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Einreichen…</>
                  ) : (
                    'Antwort einreichen'
                  )}
                </Button>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {/* Responded state */}
      {hasResponded && !respond && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="font-semibold">Antwort bereits eingereicht</p>
              <p className="text-sm text-muted-foreground">
                Status: <strong>{STATUS_LABELS[details.status]}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                Der Auftraggeber prüft Ihre Antwort und wird eine Entscheidung treffen.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Expired state */}
      {isExpired && (
        <Card className="border-red-500/30">
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <AlertTriangle className="w-10 h-10 text-red-500" />
              <p className="font-semibold text-red-600 dark:text-red-400">Antwortfrist abgelaufen</p>
              <p className="text-sm text-muted-foreground">
                Diese Anfrage kann nicht mehr beantwortet werden.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Not yet delivered */}
      {!respond && !hasResponded && !isExpired && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center gap-3 text-center">
              <Clock className="w-10 h-10 text-muted-foreground/40" />
              <p className="font-medium text-muted-foreground">Anfrage noch nicht empfangsbereit</p>
              <p className="text-sm text-muted-foreground">Status: {STATUS_LABELS[details.status] ?? details.status}</p>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
