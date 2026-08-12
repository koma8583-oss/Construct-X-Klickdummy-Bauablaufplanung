/**
 * TaktRequest detail page — 5-Schritt-Workflow (Task #118).
 *
 * 1. Datenfreigabe  — Policy akzeptieren / Status prüfen
 * 2. Taktdaten      — Details abrufen + fachliche Ansicht
 * 3. Ressourcenbedarf — Ressourcentypen + Kapazitäten erfassen
 * 4. Verfügbarkeit  — Prüfung starten, Ergebnis anzeigen
 * 5. Antwort        — Entscheidung einreichen
 *
 * Route: /takt-requests/:requestId
 */
import React, { useState } from 'react';
import { useParams, useLocation } from 'wouter';
import { format, formatDistanceToNow, differenceInHours } from 'date-fns';
import { de } from 'date-fns/locale';
import {
  useGetTaktRequestDetails,
  useSubmitNuResponse,
  useRunAvailabilityCheck,
  useGetLatestAvailabilityCheck,
  getGetTaktRequestDetailsQueryKey,
  getGetLatestAvailabilityCheckQueryKey,
  TaktDecision,
} from '@workspace/api-client-react';
import {
  useListResourceRequirements,
  useAddResourceRequirement,
  useDeleteResourceRequirement,
} from '@workspace/api-client-react';
import { useListResourceTypes } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Calendar, Clock, AlertTriangle, CheckCircle2, Loader2,
  Plus, Trash2, RefreshCw, Shield, FileText, Search, Send,
  Lock, Unlock, ChevronDown, ChevronUp, ExternalLink,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

// ── helpers ───────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Entwurf', SENT: 'Gesendet', DELIVERED: 'Zugestellt',
  DETAILS_RETRIEVED: 'Details abgerufen', UNDER_REVIEW: 'In Prüfung',
  ACCEPTED: 'Angenommen', ALTERNATIVES_PROPOSED: 'Gegenvorschlag',
  REJECTED: 'Abgelehnt', EXPIRED: 'Abgelaufen',
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

// ── Step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: 'Datenfreigabe', shortLabel: 'Policy' },
  { id: 2, label: 'Taktdaten',     shortLabel: 'Daten' },
  { id: 3, label: 'Ressourcen',    shortLabel: 'Ressourcen' },
  { id: 4, label: 'Verfügbarkeit', shortLabel: 'Verfügb.' },
  { id: 5, label: 'Antwort',       shortLabel: 'Antwort' },
];

function StepIndicator({ currentStep, completedSteps }: {
  currentStep: number;
  completedSteps: Set<number>;
}) {
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((step, idx) => {
        const isDone    = completedSteps.has(step.id);
        const isCurrent = step.id === currentStep;
        const isLocked  = step.id > currentStep && !isDone;

        return (
          <React.Fragment key={step.id}>
            {/* Step node */}
            <div className="flex flex-col items-center gap-1 flex-shrink-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-all ${
                  isDone    ? 'bg-emerald-500 border-emerald-500 text-white' :
                  isCurrent ? 'bg-primary border-primary text-primary-foreground' :
                              'bg-muted border-border text-muted-foreground'
                }`}
              >
                {isDone ? <CheckCircle2 className="w-4 h-4" /> : step.id}
              </div>
              <span className={`text-[10px] font-medium text-center leading-tight hidden sm:block ${
                isLocked ? 'text-muted-foreground/50' : isCurrent ? 'text-primary' : isDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
              }`}>
                {step.shortLabel}
              </span>
            </div>

            {/* Connector */}
            {idx < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 transition-colors ${
                  completedSteps.has(step.id) ? 'bg-emerald-500' : 'bg-border'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────

function StepSection({
  step, currentStep, completedSteps, locked, children,
}: {
  step: number;
  currentStep: number;
  completedSteps: Set<number>;
  locked?: boolean;
  children?: React.ReactNode;
}) {
  const isDone    = completedSteps.has(step);
  const isCurrent = step === currentStep;

  if (locked) {
    return (
      <div className="relative rounded-xl border border-border/50 bg-muted/20 p-5 opacity-50">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">
            Schritt {step} — {STEPS[step - 1]?.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Bitte schließen Sie die vorherigen Schritte ab.</p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border transition-all ${
      isCurrent ? 'border-primary/40 bg-primary/5' : isDone ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-border'
    }`}>
      {children}
    </div>
  );
}

// ── Policy-gate error view ─────────────────────────────────────────────────────

interface PolicyGateProps {
  pubId?: string;
  offerRef?: string;
  setLocation: (to: string) => void;
  onBack: () => void;
}

function PolicyGateView({ pubId, offerRef, setLocation, onBack }: PolicyGateProps) {
  return (
    <div className="space-y-6">
      {/* Step 1 — needs action */}
      <div className="rounded-xl border border-amber-400/50 bg-amber-50/60 dark:bg-amber-950/20 p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Shield className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
              Schritt 1 — Datenfreigabe: Policy-Annahme erforderlich
            </p>
            <p className="text-sm text-amber-800 dark:text-amber-300 mt-1">
              Um die Taktdetails einsehen zu können, müssen Sie zunächst die Nutzungs-Policy
              des zugehörigen Datenraum-Angebots akzeptieren.
            </p>
          </div>
        </div>
        {pubId && offerRef ? (
          <Button
            size="sm"
            onClick={() => setLocation('/data-offers')}
            className="gap-1.5"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Zum Datenraum → Policy akzeptieren
          </Button>
        ) : (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Wenden Sie sich an den Auftraggeber – für diese TaktAnfrage wurden noch keine
            Taktinformationen veröffentlicht.
          </p>
        )}
      </div>

      {/* Steps 2–5 locked */}
      {[2, 3, 4, 5].map(s => (
        <StepSection key={s} step={s} currentStep={1} completedSteps={new Set()} locked />
      ))}
    </div>
  );
}

// ── Alternative row ────────────────────────────────────────────────────────────

interface AltRow { start: string; end: string; }

// ── Main component ─────────────────────────────────────────────────────────────

export default function TaktRequestDetailPage() {
  const { requestId }  = useParams<{ requestId: string }>();
  const [, setLocation] = useLocation();
  const { toast }      = useToast();
  const queryClient    = useQueryClient();

  // Form state for Step 5
  const [decision, setDecision]       = useState('');
  const [acceptStart, setAcceptStart] = useState('');
  const [acceptEnd, setAcceptEnd]     = useState('');
  const [alternatives, setAlternatives] = useState<AltRow[]>([{ start: '', end: '' }]);
  const [reasonCode, setReasonCode]   = useState('');
  const [comment, setComment]         = useState('');

  // Step 3 form state
  const [newReqTypeId, setNewReqTypeId]               = useState('');
  const [newReqCapacity, setNewReqCapacity]           = useState('');
  const [newReqUtil, setNewReqUtil]                   = useState('100');
  const [newReqQual, setNewReqQual]                   = useState('');
  const [newReqStart, setNewReqStart]                 = useState('');
  const [newReqEnd, setNewReqEnd]                     = useState('');
  const [showReqForm, setShowReqForm]                 = useState(false);

  // Data queries
  const {
    data: details, isLoading, isError, error, refetch,
  } = useGetTaktRequestDetails(requestId!, {
    query: { enabled: !!requestId, queryKey: getGetTaktRequestDetailsQueryKey(requestId!) },
  });

  const { data: requirements = [], isLoading: reqLoading } = useListResourceRequirements(
    requestId!,
  );

  const { data: latestCheck } = useGetLatestAvailabilityCheck(requestId!, {
    query: {
      enabled: !!requestId && !isError,
      queryKey: getGetLatestAvailabilityCheckQueryKey(requestId!),
    },
  });

  const { data: resourceTypesResult } = useListResourceTypes();
  const resourceTypes = resourceTypesResult?.items ?? [];

  const runCheck       = useRunAvailabilityCheck();
  const addRequirement = useAddResourceRequirement();
  const deleteReq      = useDeleteResourceRequirement();
  const submitResponse = useSubmitNuResponse();

  // ── Policy-gate 403 ───────────────────────────────────────────────────────
  if (isError) {
    const errData = (error as any)?.data as Record<string, unknown> | undefined;
    const errCode = errData?.error as string | undefined;

    if (errCode === 'POLICY_ACCEPTANCE_REQUIRED') {
      const pubId    = errData?.dataPublicationId as string | undefined;
      const offerRef = errData?.dataOfferRef      as string | undefined;
      return (
        <div className="p-6 max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 text-muted-foreground"
            onClick={() => setLocation('/takt-requests')}>
            <ArrowLeft className="w-4 h-4" /> Zurück
          </Button>
          <StepIndicator currentStep={1} completedSteps={new Set()} />
          <PolicyGateView
            pubId={pubId}
            offerRef={offerRef}
            setLocation={setLocation}
            onBack={() => setLocation('/takt-requests')}
          />
        </div>
      );
    }

    if (errCode === 'DATA_PUBLICATION_INACTIVE') {
      return (
        <div className="p-6 max-w-3xl mx-auto flex flex-col items-center gap-4 py-20">
          <AlertTriangle className="w-10 h-10 text-amber-500" />
          <p className="font-medium">Datenveröffentlichung nicht mehr aktiv</p>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Die mit dieser TaktAnfrage verknüpfte Datenveröffentlichung wurde zurückgezogen.
          </p>
          <Button variant="outline" onClick={() => setLocation('/takt-requests')}>
            Zurück zur Übersicht
          </Button>
        </div>
      );
    }

    return (
      <div className="p-6 max-w-3xl mx-auto flex flex-col items-center gap-4 py-20">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">Anfrage konnte nicht geladen werden</p>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-2" />Erneut versuchen
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex items-center gap-3 py-20">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="text-muted-foreground">Lade Anfrage…</span>
      </div>
    );
  }

  if (!details) {
    return (
      <div className="p-6 max-w-3xl mx-auto flex flex-col items-center gap-4 py-20">
        <AlertTriangle className="w-10 h-10 text-destructive" />
        <p className="text-muted-foreground">Anfrage nicht gefunden</p>
        <Button variant="outline" onClick={() => setLocation('/takt-requests')}>Zurück</Button>
      </div>
    );
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const snap = details.snapshotPayload as Record<string, unknown> | undefined;
  const timeWindow = snap?.plannedTimeWindow as Record<string, unknown> | undefined;
  const snapLocation = snap?.location       as Record<string, unknown> | undefined;
  const snapStart  = ((timeWindow?.start ?? snap?.plannedStart) as string | undefined);
  const snapEnd    = ((timeWindow?.end   ?? snap?.plannedEnd)   as string | undefined);
  const snapBez    = ((snap?.workPackage  ?? snap?.taktBezeichnung) as string | undefined);
  const snapZone   = ((snapLocation?.zone ?? snap?.zone)            as string | undefined);
  const snapGewerk = ((snap?.trade        ?? snap?.gewerk)          as string | undefined);
  const snapDesc   = ((snap?.requiredOutput ?? snap?.description)    as string | undefined);
  const bufferWindow = snap?.bufferTimeWindow as Record<string, unknown> | undefined;
  const bufferStart  = bufferWindow?.earliestStart as string | undefined;
  const bufferEnd    = bufferWindow?.latestEnd     as string | undefined;

  const status       = details.status;
  const hasResponded = ['ACCEPTED', 'ALTERNATIVES_PROPOSED', 'REJECTED'].includes(status);
  const isExpired    = status === 'EXPIRED';
  const canAct       = canRespond(status);
  const detailsGot   = !!details.detailsRetrievedAt;

  // Deadline urgency
  const deadlineDate = details.responseRequiredBy ? new Date(details.responseRequiredBy) : null;
  const hoursUntilDeadline = deadlineDate ? differenceInHours(deadlineDate, new Date()) : null;
  const isUrgent = hoursUntilDeadline !== null && hoursUntilDeadline >= 0 && hoursUntilDeadline < 24;

  // Step completion
  // Step 1: policy OK = we loaded the data (no 403)
  const step1Done = true; // if we reached here, policy is OK or no policy required
  const step2Done = detailsGot;
  const step3Done = requirements.length > 0;
  const step4Done = !!latestCheck && latestCheck.status === 'COMPLETED';
  const step5Done = hasResponded;

  const completedSteps = new Set<number>(
    [step1Done && 1, step2Done && 2, step3Done && 3, step4Done && 4, step5Done && 5]
      .filter(Boolean) as number[],
  );

  const currentStep =
    !step1Done ? 1 :
    !step2Done ? 2 :
    !step3Done ? 3 :
    !step4Done ? 4 :
    !step5Done ? 5 : 5;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleRunCheck = () => {
    runCheck.mutate({ requestId: requestId! }, {
      onSuccess: () => {
        toast({ title: 'Verfügbarkeitsprüfung abgeschlossen' });
        queryClient.invalidateQueries({ queryKey: getGetLatestAvailabilityCheckQueryKey(requestId!) });
        queryClient.invalidateQueries({ queryKey: getGetTaktRequestDetailsQueryKey(requestId!) });
      },
      onError: (err) => toast({ title: 'Fehler', description: (err as Error).message, variant: 'destructive' }),
    });
  };

  const handleAddRequirement = () => {
    addRequirement.mutate({
      requestId: requestId!,
      data: {
        resourceTypeId:       newReqTypeId || null,
        requiredCapacity:     newReqCapacity ? parseFloat(newReqCapacity) : null,
        utilizationPercent:   parseInt(newReqUtil) || 100,
        requiredQualification: newReqQual || null,
        periodStart: newReqStart || (snapStart?.substring(0, 10) ?? null),
        periodEnd:   newReqEnd   || (snapEnd?.substring(0, 10)   ?? null),
      },
    }, {
      onSuccess: () => {
        toast({ title: 'Ressourcenbedarf gespeichert' });
        setShowReqForm(false);
        setNewReqTypeId(''); setNewReqCapacity(''); setNewReqUtil('100');
        setNewReqQual(''); setNewReqStart(''); setNewReqEnd('');
      },
      onError: (err) => toast({ title: 'Fehler', description: (err as Error).message, variant: 'destructive' }),
    });
  };

  const handleDeleteReq = (reqId: string) => {
    deleteReq.mutate({ requestId: requestId!, requirementId: reqId }, {
      onError: (err) => toast({ title: 'Fehler', description: (err as Error).message, variant: 'destructive' }),
    });
  };

  // ── Alternative validation ────────────────────────────────────────────────
  const altRowErrors: Array<{ emptyStart: boolean; emptyEnd: boolean; endBeforeStart: boolean }> =
    alternatives.map(a => ({
      emptyStart:     !a.start,
      emptyEnd:       !a.end,
      endBeforeStart: !!a.start && !!a.end && a.end < a.start,
    }));
  const altDatesInvalid =
    decision === TaktDecision.ALTERNATIVES_PROPOSED &&
    altRowErrors.some(e => e.emptyStart || e.emptyEnd || e.endBeforeStart);

  const handleDecisionChange = (val: string) => {
    setDecision(val);
    if (val === TaktDecision.ACCEPTED && snapStart && !acceptStart) {
      setAcceptStart(snapStart.substring(0, 10));
      setAcceptEnd((snapEnd ?? '').substring(0, 10));
    }
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
        alternativeId: `alt-${i + 1}`,
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
        setDecision(''); setAcceptStart(''); setAcceptEnd('');
        setAlternatives([{ start: '', end: '' }]);
        setReasonCode(''); setComment('');
      },
      onError: (err) => toast({ title: 'Fehler beim Einreichen', description: (err as Error).message, variant: 'destructive' }),
    });
  };

  // ── Availability result ────────────────────────────────────────────────────

  const checkResult = latestCheck?.result;
  const publicResult = (latestCheck as any)?.publicResult;
  const checkResultMeta = checkResult === 'FEASIBLE'
    ? { label: 'Machbar', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30', decision: TaktDecision.ACCEPTED }
    : checkResult === 'FEASIBLE_WITH_ALTERNATIVES'
      ? { label: 'Teilweise machbar', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10 border-amber-500/30', decision: TaktDecision.ALTERNATIVES_PROPOSED }
      : checkResult === 'NOT_FEASIBLE'
        ? { label: 'Nicht machbar', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-500/10 border-red-500/30', decision: TaktDecision.REJECTED }
        : null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6 animate-in fade-in duration-300">

      {/* Back navigation */}
      <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 text-muted-foreground"
        onClick={() => setLocation('/takt-requests')}>
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
          {STATUS_LABELS[status] ?? status}
        </Badge>
      </div>

      {/* Deadline banner */}
      {details.responseRequiredBy ? (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border text-sm ${
          isExpired
            ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400'
            : isUrgent
              ? 'border-amber-500/60 bg-amber-500/10 text-amber-800 dark:text-amber-300'
              : 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-300'
        }`}>
          <Clock className={`w-4 h-4 shrink-0 ${isExpired ? 'text-red-500' : isUrgent ? 'text-amber-500' : 'text-slate-400'}`} />
          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-2 flex-1">
            <span>
              {isExpired ? (
                <>Antwortfrist <strong>abgelaufen</strong> –&nbsp;</>
              ) : (
                <>Antwortfrist: </>
              )}
              <strong>{fmtDateTime(details.responseRequiredBy)}</strong>
            </span>
            {deadlineDate && !isExpired && (
              <span className={`text-xs ${isUrgent ? 'font-semibold' : 'opacity-70'}`}>
                (noch {formatDistanceToNow(deadlineDate, { locale: de, addSuffix: false })})
              </span>
            )}
          </div>
          {isUrgent && (
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border/40 bg-muted/20 text-sm text-muted-foreground">
          <Clock className="w-4 h-4 shrink-0 opacity-40" />
          <span>Keine Frist gesetzt</span>
        </div>
      )}

      {/* Step indicator */}
      <StepIndicator currentStep={currentStep} completedSteps={completedSteps} />

      {/* ── Step 1: Datenfreigabe ─────────────────────────────────────────── */}
      <StepSection step={1} currentStep={currentStep} completedSteps={completedSteps}>
        <CardHeader className="pb-2 px-5 pt-5">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Schritt 1 — Datenfreigabe
            </CardTitle>
            {step1Done && (
              <Badge variant="secondary" className="ml-auto text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                <CheckCircle2 className="w-3 h-3 mr-1" />Akzeptiert
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Status</div>
              <div className="text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <Unlock className="w-3.5 h-3.5" />
                Policy akzeptiert
              </div>
            </div>
            {details.detailsRetrievedAt && (
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Taktdaten abgerufen am</div>
                <div className="font-medium">{fmtDateTime(details.detailsRetrievedAt)}</div>
              </div>
            )}
          </div>
        </CardContent>
      </StepSection>

      {/* ── Step 2: Taktdaten ─────────────────────────────────────────────── */}
      <StepSection step={2} currentStep={currentStep} completedSteps={completedSteps} locked={!step1Done}>
        <CardHeader className="pb-2 px-5 pt-5">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Schritt 2 — Taktdaten
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-4">
          {!detailsGot && canAct ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Rufen Sie die Taktdaten ab, um alle Details einzusehen. Dieser Schritt bestätigt
                den Empfang der Anfrage beim Auftraggeber.
              </p>
              <Button variant="outline" onClick={() => refetch()} disabled={isLoading} className="w-fit gap-2">
                <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                Taktdaten abrufen
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
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
                  <Calendar className="w-3.5 h-3.5 opacity-50" />{fmtDate(snapStart)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-0.5">Geplantes Ende</div>
                <div className="font-medium flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 opacity-50" />{fmtDate(snapEnd)}
                </div>
              </div>
              {/* ── Fristen ─────────────────────────────────────────────── */}
              {(details.responseRequiredBy || bufferStart || bufferEnd) && (
                <div className="sm:col-span-2 pt-2 border-t border-border mt-1">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    Fristen
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
                    {details.responseRequiredBy && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">Antwortfrist</div>
                        <div className={`font-medium flex items-center gap-1.5 ${
                          isExpired ? 'text-red-600 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'
                        }`}>
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          {fmtDateTime(details.responseRequiredBy)}
                          {isExpired && <span className="text-xs">(abgelaufen)</span>}
                        </div>
                      </div>
                    )}
                    {bufferStart && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">Frühester Beginn (Puffer)</div>
                        <div className="font-medium flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 opacity-50" />{fmtDate(bufferStart)}
                        </div>
                      </div>
                    )}
                    {bufferEnd && (
                      <div>
                        <div className="text-xs text-muted-foreground mb-0.5">Spätestes Ende (Puffer)</div>
                        <div className="font-medium flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 opacity-50" />{fmtDate(bufferEnd)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {snapDesc && (
                <div className="sm:col-span-2">
                  <div className="text-xs text-muted-foreground mb-0.5">Beschreibung</div>
                  <div className="text-sm text-foreground/80">{snapDesc}</div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </StepSection>

      {/* ── Step 3: Ressourcenbedarf ─────────────────────────────────────── */}
      <StepSection step={3} currentStep={currentStep} completedSteps={completedSteps} locked={!step2Done && !step1Done}>
        <CardHeader className="pb-2 px-5 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Schritt 3 — Ressourcenbedarf
              </CardTitle>
            </div>
            {!hasResponded && (
              <Button variant="ghost" size="sm" onClick={() => setShowReqForm(v => !v)} className="gap-1 text-xs">
                <Plus className="w-3.5 h-3.5" />Hinzufügen
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-3">
          {/* Existing requirements */}
          {reqLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />Lade Bedarfe…
            </div>
          ) : requirements.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Noch kein Ressourcenbedarf erfasst. Fügen Sie mindestens einen Ressourcentyp hinzu.
            </p>
          ) : (
            <div className="space-y-2">
              {requirements.map((req: any) => (
                <div key={req.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border/50">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">
                      {req.resourceTypeName ?? 'Ressourcentyp nicht angegeben'}
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-3 mt-0.5">
                      {req.requiredCapacity && (
                        <span>Kapazität: {req.requiredCapacity}</span>
                      )}
                      <span>Auslastung: {req.utilizationPercent}%</span>
                      {req.periodStart && (
                        <span>{fmtDate(req.periodStart)} – {fmtDate(req.periodEnd)}</span>
                      )}
                      {req.requiredQualification && (
                        <span>Qual.: {req.requiredQualification}</span>
                      )}
                    </div>
                  </div>
                  {!hasResponded && (
                    <Button variant="ghost" size="icon"
                      className="shrink-0 text-muted-foreground hover:text-red-500"
                      onClick={() => handleDeleteReq(req.id)}
                      disabled={deleteReq.isPending}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          {showReqForm && !hasResponded && (
            <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs">Ressourcentyp</Label>
                  <Select value={newReqTypeId} onValueChange={setNewReqTypeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Typ wählen…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(resourceTypes as any[]).map((rt: any) => (
                        <SelectItem key={rt.id} value={rt.id}>
                          {rt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Benötigte Kapazität</Label>
                  <Input type="number" min="0" step="0.5"
                    value={newReqCapacity} onChange={e => setNewReqCapacity(e.target.value)}
                    placeholder="z.B. 2" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Auslastung %</Label>
                  <Input type="number" min="1" max="100"
                    value={newReqUtil} onChange={e => setNewReqUtil(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Zeitraum Start</Label>
                  <Input type="date"
                    value={newReqStart || (snapStart?.substring(0, 10) ?? '')}
                    onChange={e => setNewReqStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Zeitraum Ende</Label>
                  <Input type="date"
                    value={newReqEnd || (snapEnd?.substring(0, 10) ?? '')}
                    onChange={e => setNewReqEnd(e.target.value)} />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                  <Label className="text-xs">Erforderliche Qualifikation (optional)</Label>
                  <Input value={newReqQual} onChange={e => setNewReqQual(e.target.value)}
                    placeholder="z.B. Kranführerschein" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleAddRequirement} disabled={addRequirement.isPending} className="gap-1">
                  {addRequirement.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  Speichern
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowReqForm(false)}>Abbrechen</Button>
              </div>
            </div>
          )}

          {requirements.length > 0 && !hasResponded && (
            <p className="text-xs text-muted-foreground">
              {requirements.length} Ressourcenbedarf{requirements.length !== 1 ? 'e' : ''} erfasst.
              Starten Sie nach der Erfassung die Verfügbarkeitsprüfung.
            </p>
          )}
        </CardContent>
      </StepSection>

      {/* ── Step 4: Verfügbarkeit ──────────────────────────────────────────── */}
      <StepSection step={4} currentStep={currentStep} completedSteps={completedSteps}
        locked={!step2Done}>
        <CardHeader className="pb-2 px-5 pt-5">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Schritt 4 — Verfügbarkeitsprüfung
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5 space-y-3">
          {canAct && !hasResponded && (
            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleRunCheck}
                disabled={runCheck.isPending} className="gap-2">
                {runCheck.isPending
                  ? <><Loader2 className="w-4 h-4 animate-spin" />Prüfung läuft…</>
                  : <><RefreshCw className="w-4 h-4" />{step4Done ? 'Erneut prüfen' : 'Verfügbarkeit prüfen'}</>}
              </Button>
              {step4Done && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={`/availability-checks?requestId=${requestId}`} className="gap-1 text-xs text-muted-foreground">
                    Prüfdetails <ExternalLink className="w-3 h-3" />
                  </a>
                </Button>
              )}
            </div>
          )}

          {latestCheck && (
            <div className={`rounded-lg border p-4 space-y-2 ${checkResultMeta?.bg ?? 'bg-muted/30 border-border'}`}>
              <div className="flex items-center gap-2">
                {checkResult === 'FEASIBLE' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                {checkResult === 'FEASIBLE_WITH_ALTERNATIVES' && <AlertTriangle className="w-4 h-4 text-amber-500" />}
                {checkResult === 'NOT_FEASIBLE' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                <span className={`font-semibold text-sm ${checkResultMeta?.color ?? ''}`}>
                  {checkResultMeta?.label ?? latestCheck.result ?? latestCheck.status}
                </span>
                {latestCheck.checkedAt && (
                  <span className="text-xs text-muted-foreground ml-auto">
                    {fmtDateTime(latestCheck.checkedAt)}
                  </span>
                )}
              </div>

              {publicResult?.reasonCode && publicResult.reasonCode !== 'FEASIBLE' && (
                <p className="text-xs text-muted-foreground">Code: {publicResult.reasonCode}</p>
              )}

              {publicResult?.alternatives && publicResult.alternatives.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs font-medium text-muted-foreground">Mögliche Alternativen:</p>
                  {publicResult.alternatives.map((alt: any) => (
                    <div key={alt.alternativeId} className="text-xs bg-background/60 rounded px-2 py-1.5 flex items-center justify-between gap-2">
                      <span className="font-medium">Alt. {alt.rank}</span>
                      <span>{fmtDate(alt.timeWindow?.start)} – {fmtDate(alt.timeWindow?.end)}</span>
                      {alt.crewSize && <span>{alt.crewSize} Pers.</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {!latestCheck && !canAct && (
            <p className="text-sm text-muted-foreground">Keine Verfügbarkeitsprüfung vorhanden.</p>
          )}
          {!latestCheck && canAct && !runCheck.isPending && (
            <p className="text-sm text-muted-foreground">
              Noch keine Prüfung durchgeführt. Klicken Sie auf „Verfügbarkeit prüfen".
            </p>
          )}
        </CardContent>
      </StepSection>

      {/* ── Step 5: Antwort ───────────────────────────────────────────────── */}
      <StepSection step={5} currentStep={currentStep} completedSteps={completedSteps}
        locked={!canAct && !hasResponded}>
        <CardHeader className="pb-2 px-5 pt-5">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-primary" />
            <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Schritt 5 — Antwort einreichen
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent className="px-5 pb-5">

          {hasResponded ? (
            <div className="flex flex-col items-center gap-3 text-center py-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="font-semibold">Antwort bereits eingereicht</p>
              <p className="text-sm text-muted-foreground">
                Status: <strong>{STATUS_LABELS[status]}</strong>
              </p>
            </div>
          ) : isExpired ? (
            <div className="flex flex-col items-center gap-3 text-center py-6">
              <AlertTriangle className="w-10 h-10 text-red-500" />
              <p className="font-semibold text-red-600 dark:text-red-400">Antwortfrist abgelaufen</p>
            </div>
          ) : !canAct ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Status: {STATUS_LABELS[status] ?? status}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Pre-fill hint from availability check */}
              {step4Done && checkResultMeta && !decision && (
                <div className={`text-xs px-3 py-2 rounded border ${checkResultMeta.bg} ${checkResultMeta.color}`}>
                  Empfehlung auf Basis der Prüfung: <strong>{checkResultMeta.label}</strong>
                </div>
              )}

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

              {decision === TaktDecision.ACCEPTED && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Bestätigter Start</Label>
                    <Input type="date" value={acceptStart}
                      onChange={e => setAcceptStart(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Bestätigtes Ende</Label>
                    <Input type="date" value={acceptEnd}
                      onChange={e => setAcceptEnd(e.target.value)} required />
                  </div>
                </div>
              )}

              {decision === TaktDecision.ALTERNATIVES_PROPOSED && (
                <div className="space-y-3 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Alternativtermine (bis zu 3)</span>
                    {alternatives.length < 3 && (
                      <Button type="button" variant="ghost" size="sm"
                        onClick={() => setAlternatives(prev => [...prev, { start: '', end: '' }])}>
                        <Plus className="w-3.5 h-3.5 mr-1" />Hinzufügen
                      </Button>
                    )}
                  </div>
                  {alternatives.map((alt, idx) => {
                    const rowErr = altRowErrors[idx];
                    return (
                      <div key={idx} className="space-y-1">
                        <div className="flex items-end gap-2">
                          <div className="flex-1 space-y-1">
                            <Label className="text-xs">Alternative {idx + 1} — Start</Label>
                            <Input type="date" value={alt.start}
                              className={rowErr?.emptyStart ? 'border-destructive' : ''}
                              onChange={e => setAlternatives(prev => prev.map((a, i) => i === idx ? { ...a, start: e.target.value } : a))}
                              required />
                          </div>
                          <div className="flex-1 space-y-1">
                            <Label className="text-xs">Ende</Label>
                            <Input type="date" value={alt.end}
                              className={(rowErr?.emptyEnd || rowErr?.endBeforeStart) ? 'border-destructive' : ''}
                              onChange={e => setAlternatives(prev => prev.map((a, i) => i === idx ? { ...a, end: e.target.value } : a))}
                              required />
                          </div>
                          {alternatives.length > 1 && (
                            <Button type="button" variant="ghost" size="icon"
                              className="shrink-0 text-muted-foreground hover:text-red-500"
                              onClick={() => setAlternatives(prev => prev.filter((_, i) => i !== idx))}>
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        {rowErr?.endBeforeStart && (
                          <p className="flex items-center gap-1.5 text-xs text-destructive">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            Ende-Datum muss nach dem Start-Datum liegen.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

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
                    <Textarea value={comment} onChange={e => setComment(e.target.value)}
                      placeholder="Interner Hinweis (wird nicht übermittelt)"
                      className="h-20 resize-none" maxLength={500} />
                  </div>
                </div>
              )}

              {decision && (
                <Button type="submit" className="w-full gap-2"
                  disabled={submitResponse.isPending || altDatesInvalid}>
                  {submitResponse.isPending
                    ? <><Loader2 className="w-4 h-4 animate-spin" />Einreichen…</>
                    : <><Send className="w-4 h-4" />Antwort einreichen</>}
                </Button>
              )}
            </form>
          )}
        </CardContent>
      </StepSection>

    </div>
  );
}
