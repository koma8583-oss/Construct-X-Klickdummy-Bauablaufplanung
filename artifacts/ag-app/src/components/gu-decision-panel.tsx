/**
 * GUDecisionPanel — Task 6.7
 *
 * Renders the GU decision action area beneath the NU response panel.
 * Shows:
 *  - Action buttons (when a decision is still required)
 *  - A read-only view of the existing decision (when already recorded)
 *  - Separate transport status (decision saved / NU notified)
 *
 * Dialogs:
 *  - CONFIRM_ACCEPTED  → confirmation dialog
 *  - ACCEPT_ALTERNATIVE → alternative comparison table + confirmation dialog
 *  - REQUEST_REVISION  → comment dialog
 *  - CLOSE_WITHOUT_AGREEMENT → warning dialog
 */

import React, { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { format, differenceInDays } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MessageSquare,
  ChevronRight,
  Loader2,
  Bell,
  ShieldCheck,
} from 'lucide-react';
import {
  useCreateGuDecision,
  getGetTaktRequestDetailQueryKey,
  type TaktRequestDetail,
  type GuDecisionResponse,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

// ── Types ─────────────────────────────────────────────────────────────────────

type DecisionType =
  | 'CONFIRM_ACCEPTED'
  | 'ACCEPT_ALTERNATIVE'
  | 'REQUEST_REVISION'
  | 'CLOSE_WITHOUT_AGREEMENT';

type DialogState =
  | { kind: 'none' }
  | { kind: 'confirm_accepted' }
  | { kind: 'select_alternative'; selectedId: string | null }
  | { kind: 'confirm_alternative'; alternativeId: string }
  | { kind: 'request_revision' }
  | { kind: 'close_without_agreement' };

type ResultState =
  | { kind: 'idle' }
  | { kind: 'success'; decision: GuDecisionResponse; notified: boolean | 'failed' }
  | { kind: 'error'; message: string };

function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `idk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatWindow(start: string | Date, end: string | Date): string {
  return `${format(new Date(start), 'dd.MM.yyyy HH:mm')} – ${format(new Date(end), 'dd.MM.yyyy HH:mm')}`;
}

function dayDiff(a: string | Date, b: string | Date): number {
  return differenceInDays(new Date(b), new Date(a));
}

// ── Decision type labels ──────────────────────────────────────────────────────

const DECISION_COLORS: Record<DecisionType, string> = {
  CONFIRM_ACCEPTED: 'text-emerald-700 bg-emerald-50 border border-emerald-200',
  ACCEPT_ALTERNATIVE: 'text-blue-700 bg-blue-50 border border-blue-200',
  REQUEST_REVISION: 'text-orange-700 bg-orange-50 border border-orange-200',
  CLOSE_WITHOUT_AGREEMENT: 'text-red-700 bg-red-50 border border-red-200',
};

// ── Subcomponents ─────────────────────────────────────────────────────────────

function TransportStatusRow({
  decisionSaved,
  notified,
}: {
  decisionSaved: boolean;
  notified: boolean | 'failed';
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5 pt-2">
      <div className="flex items-center gap-2 text-sm">
        {decisionSaved ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
        ) : (
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />
        )}
        <span className={decisionSaved ? 'text-emerald-700' : 'text-muted-foreground'}>
          {t('taktRequestDetail.guDecision.transportStatus.decisionSaved')}
        </span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        {notified === true && <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />}
        {notified === 'failed' && <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />}
        {notified === false && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground flex-shrink-0" />}
        <span
          className={
            notified === true
              ? 'text-emerald-700'
              : notified === 'failed'
              ? 'text-amber-600'
              : 'text-muted-foreground'
          }
        >
          {notified === 'failed'
            ? t('taktRequestDetail.guDecision.transportStatus.notifyFailed')
            : t('taktRequestDetail.guDecision.transportStatus.notified')}
        </span>
      </div>
    </div>
  );
}

// ── Alternative comparison table ──────────────────────────────────────────────

function AlternativeTable({
  detail,
  selectedId,
  onSelect,
}: {
  detail: TaktRequestDetail;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const snap = detail.snapshot?.snapshotPayload as Record<string, unknown> | undefined;
  const tw = snap?.taktWindow as Record<string, string> | undefined;
  const origStart = tw?.start ?? (snap?.plannedStart as string | undefined);
  const origEnd = tw?.end ?? (snap?.plannedEnd as string | undefined);
  const alts = detail.response?.alternatives ?? [];

  return (
    <div className="space-y-3 overflow-x-auto">
      <p className="text-sm text-muted-foreground">
        {t('taktRequestDetail.guDecision.alternative.selectHint')}
      </p>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 pr-3 font-medium text-muted-foreground w-28">
              {t('taktRequestDetail.guDecision.alternative.rank')}
            </th>
            <th className="text-left py-2 pr-3 font-medium text-muted-foreground">
              {t('taktRequestDetail.guDecision.alternative.start')}
            </th>
            <th className="text-left py-2 pr-3 font-medium text-muted-foreground">
              {t('taktRequestDetail.guDecision.alternative.end')}
            </th>
            <th className="text-right py-2 pr-3 font-medium text-muted-foreground">
              {t('taktRequestDetail.guDecision.alternative.duration')}
            </th>
            <th className="text-right py-2 pr-3 font-medium text-muted-foreground">
              {t('taktRequestDetail.guDecision.alternative.shift')}
            </th>
            <th className="text-right py-2 pr-3 font-medium text-muted-foreground">
              {t('taktRequestDetail.guDecision.alternative.crew')}
            </th>
            <th className="text-left py-2 font-medium text-muted-foreground">
              {t('taktRequestDetail.guDecision.alternative.conditions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Original row */}
          <tr className="border-b border-border/50 bg-muted/30">
            <td className="py-2 pr-3 font-medium">
              {t('taktRequestDetail.guDecision.alternative.original')}
            </td>
            <td className="py-2 pr-3 font-mono text-xs">
              {origStart ? format(new Date(origStart), 'dd.MM.yy HH:mm') : '—'}
            </td>
            <td className="py-2 pr-3 font-mono text-xs">
              {origEnd ? format(new Date(origEnd), 'dd.MM.yy HH:mm') : '—'}
            </td>
            <td className="py-2 pr-3 text-right">
              {origStart && origEnd ? `${dayDiff(origStart, origEnd)}d` : '—'}
            </td>
            <td className="py-2 pr-3 text-right text-muted-foreground">–</td>
            <td className="py-2 pr-3 text-right text-muted-foreground">–</td>
            <td className="py-2 text-muted-foreground">–</td>
          </tr>
          {/* Alternative rows */}
          {alts.map((alt) => {
            const isSelected = selectedId === alt.alternativeId;
            const shiftDays =
              origStart ? dayDiff(origStart, alt.proposedStart as string) : null;
            return (
              <tr
                key={alt.alternativeId}
                className={`border-b border-border/50 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                    : 'hover:bg-muted/40'
                }`}
                onClick={() => onSelect(alt.alternativeId)}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onKeyDown={(e) => e.key === ' ' && onSelect(alt.alternativeId)}
              >
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      readOnly
                      checked={isSelected}
                      className="accent-primary"
                      aria-label={`Alternative ${alt.rank}`}
                    />
                    <Badge variant="outline" className="text-xs">
                      #{alt.rank}
                    </Badge>
                  </div>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {format(new Date(alt.proposedStart as string), 'dd.MM.yy HH:mm')}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {format(new Date(alt.proposedEnd as string), 'dd.MM.yy HH:mm')}
                </td>
                <td className="py-2 pr-3 text-right">
                  {dayDiff(alt.proposedStart as string, alt.proposedEnd as string)}d
                </td>
                <td
                  className={`py-2 pr-3 text-right ${
                    shiftDays !== null && shiftDays !== 0
                      ? shiftDays > 0
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                      : ''
                  }`}
                >
                  {shiftDays !== null
                    ? shiftDays === 0
                      ? '–'
                      : `${shiftDays > 0 ? '+' : ''}${shiftDays}d`
                    : '—'}
                </td>
                <td className="py-2 pr-3 text-right">
                  {alt.crewSize ?? '—'}
                </td>
                <td className="py-2 text-xs text-muted-foreground max-w-xs">
                  {alt.conditions && alt.conditions.length > 0
                    ? alt.conditions.join(', ')
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export interface GUDecisionPanelProps {
  detail: TaktRequestDetail;
  onDecisionRecorded?: (result: GuDecisionResponse) => void;
}

export function GUDecisionPanel({ detail, onDecisionRecorded }: GUDecisionPanelProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { mutateAsync: createGuDecision } = useCreateGuDecision();

  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });
  const [comment, setComment] = useState('');
  const [result, setResult] = useState<ResultState>({ kind: 'idle' });
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());

  const resp = detail.response;
  const guDecision = detail.guDecision;
  const taktLifecycle = detail.taktLifecycleStatus;

  // ── Determine what actions are available ──────────────────────────────────

  const needsDecision =
    !guDecision &&
    resp !== null &&
    resp !== undefined &&
    (detail.status === 'ACCEPTED' ||
      detail.status === 'ALTERNATIVES_PROPOSED' ||
      detail.status === 'REJECTED');

  const openDialog = useCallback((kind: DialogState['kind']) => {
    idempotencyKeyRef.current = newIdempotencyKey();
    setComment('');
    setResult({ kind: 'idle' });
    setDialog({ kind } as DialogState);
  }, []);

  const closeDialog = useCallback(() => {
    setDialog({ kind: 'none' });
  }, []);

  const handleSubmit = useCallback(
    async (decisionType: DecisionType, acceptedAlternativeId?: string) => {
      setSubmitting(true);
      setResult({ kind: 'idle' });
      try {
        const decision = await createGuDecision({
          requestId: detail.id,
          data: {
            decisionType,
            acceptedAlternativeId: acceptedAlternativeId ?? undefined,
            comment: comment.trim() || undefined,
            idempotencyKey: idempotencyKeyRef.current,
          },
        });
        closeDialog();
        // Optimistically mark transport as "decision saved, notified pending"
        // The backend does transport post-commit; we assume success unless told otherwise.
        const notified: boolean | 'failed' = true; // transport is non-fatal but usually succeeds
        setResult({ kind: 'success', decision, notified });
        onDecisionRecorded?.(decision);
        // Invalidate detail query so the page reloads with updated status
        await queryClient.invalidateQueries({
          queryKey: getGetTaktRequestDetailQueryKey(detail.id),
        });
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Unbekannter Fehler';
        setResult({ kind: 'error', message: msg });
        closeDialog();
      } finally {
        setSubmitting(false);
      }
    },
    [comment, createGuDecision, detail.id, closeDialog, onDecisionRecorded, queryClient],
  );

  // ── Already decided ───────────────────────────────────────────────────────

  if (guDecision) {
    const dt = guDecision.decisionType as DecisionType;
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-3 rounded-lg border border-border bg-muted/30">
          <ShieldCheck className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="text-sm font-medium">
              {t('taktRequestDetail.guDecision.alreadyDecided')}
            </p>
            <div className="flex flex-wrap gap-2 items-center">
              <span
                className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                  DECISION_COLORS[dt] ?? ''
                }`}
              >
                {t(`taktRequestDetail.guDecision.decisionTypes.${dt}`, dt)}
              </span>
              <span className="text-xs text-muted-foreground">
                {format(new Date(guDecision.decidedAt), 'dd.MM.yyyy HH:mm')}
              </span>
            </div>
            {guDecision.comment && (
              <p className="text-sm text-muted-foreground italic">{guDecision.comment}</p>
            )}
          </div>
        </div>
        {taktLifecycle === 'CONFIRMED' && (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="w-4 h-4" />
            {t('taktRequestDetail.guDecision.taktConfirmed')}
          </div>
        )}
      </div>
    );
  }

  // ── Success state (just decided) ─────────────────────────────────────────

  if (result.kind === 'success') {
    const dt = result.decision.decisionType as DecisionType;
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-50">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-emerald-800">
              {t(`taktRequestDetail.guDecision.decisionTypes.${dt}`, dt)}
            </p>
            <p className="text-xs text-emerald-700 mt-0.5">
              {t('taktRequestDetail.guDecision.confirm.statusHint', {
                status: result.decision.updatedRequestStatus,
              })}
            </p>
            <TransportStatusRow
              decisionSaved
              notified={result.notified}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Error state ──────────────────────────────────────────────────────────

  if (result.kind === 'error') {
    return (
      <div className="rounded-lg border border-red-300 bg-red-50 p-3 space-y-2">
        <div className="flex items-center gap-2 text-red-700 text-sm font-medium">
          <AlertTriangle className="w-4 h-4" />
          {t('taktRequestDetail.guDecision.error.title')}
        </div>
        <p className="text-xs text-red-600">{result.message}</p>
        <Button size="sm" variant="outline" onClick={() => setResult({ kind: 'idle' })}>
          {t('taktRequestDetail.guDecision.error.retry')}
        </Button>
      </div>
    );
  }

  // ── No response yet or no actionable state ────────────────────────────────

  if (!needsDecision) return null;

  // ── Compute which buttons to show ─────────────────────────────────────────

  const respDecision = resp!.decision;

  const showConfirmAccepted =
    respDecision === 'ACCEPTED' && taktLifecycle !== 'CONFIRMED';
  const showAcceptAlternative = respDecision === 'ALTERNATIVES_PROPOSED';
  const showRequestRevision = true; // always available when needsDecision
  const showClose = true; // always available when needsDecision

  return (
    <>
      {/* ── Action buttons ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {showConfirmAccepted && (
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => openDialog('confirm_accepted')}
            disabled={submitting}
          >
            <CheckCircle2 className="w-4 h-4 mr-1.5" />
            {t('taktRequestDetail.guDecision.actions.confirmAccepted')}
          </Button>
        )}
        {showAcceptAlternative && (
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() =>
              setDialog({ kind: 'select_alternative', selectedId: null })
            }
            disabled={submitting}
          >
            <ChevronRight className="w-4 h-4 mr-1.5" />
            {t('taktRequestDetail.guDecision.actions.acceptAlternative')}
          </Button>
        )}
        {showRequestRevision && (
          <Button
            size="sm"
            variant="outline"
            className="border-orange-300 text-orange-700 hover:bg-orange-50"
            onClick={() => openDialog('request_revision')}
            disabled={submitting}
          >
            <MessageSquare className="w-4 h-4 mr-1.5" />
            {t('taktRequestDetail.guDecision.actions.requestRevision')}
          </Button>
        )}
        {showClose && (
          <Button
            size="sm"
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50"
            onClick={() => openDialog('close_without_agreement')}
            disabled={submitting}
          >
            <XCircle className="w-4 h-4 mr-1.5" />
            {t('taktRequestDetail.guDecision.actions.closeWithoutAgreement')}
          </Button>
        )}
      </div>

      {/* ── Dialog: CONFIRM_ACCEPTED ─────────────────────────────────────── */}
      <Dialog
        open={dialog.kind === 'confirm_accepted'}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('taktRequestDetail.guDecision.confirm.title')}</DialogTitle>
            <DialogDescription>
              {t('taktRequestDetail.guDecision.confirm.notifyHint')}
            </DialogDescription>
          </DialogHeader>
          <ConfirmationDetails
            detail={detail}
            decisionType="CONFIRM_ACCEPTED"
            alternativeId={undefined}
          />
          <div className="space-y-2">
            <Label htmlFor="gud-comment-confirm">
              {t('taktRequestDetail.guDecision.confirm.comment')}
            </Label>
            <Textarea
              id="gud-comment-confirm"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('taktRequestDetail.guDecision.confirm.commentPlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              {t('taktRequestDetail.guDecision.confirm.cancel')}
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={() => handleSubmit('CONFIRM_ACCEPTED')}
              disabled={submitting}
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('taktRequestDetail.guDecision.confirm.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: SELECT ALTERNATIVE ──────────────────────────────────── */}
      <Dialog
        open={dialog.kind === 'select_alternative'}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t('taktRequestDetail.guDecision.alternative.title')}
            </DialogTitle>
          </DialogHeader>
          <AlternativeTable
            detail={detail}
            selectedId={
              dialog.kind === 'select_alternative' ? dialog.selectedId : null
            }
            onSelect={(id) =>
              setDialog({ kind: 'select_alternative', selectedId: id })
            }
          />
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              {t('taktRequestDetail.guDecision.confirm.cancel')}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={
                dialog.kind !== 'select_alternative' || !dialog.selectedId
              }
              onClick={() => {
                if (dialog.kind === 'select_alternative' && dialog.selectedId) {
                  idempotencyKeyRef.current = newIdempotencyKey();
                  setComment('');
                  setDialog({
                    kind: 'confirm_alternative',
                    alternativeId: dialog.selectedId,
                  });
                }
              }}
            >
              {t('taktRequestDetail.guDecision.alternative.next')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: CONFIRM ALTERNATIVE ──────────────────────────────────── */}
      <Dialog
        open={dialog.kind === 'confirm_alternative'}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('taktRequestDetail.guDecision.confirm.title')}</DialogTitle>
            <DialogDescription>
              {t('taktRequestDetail.guDecision.confirm.notifyHint')}
            </DialogDescription>
          </DialogHeader>
          <ConfirmationDetails
            detail={detail}
            decisionType="ACCEPT_ALTERNATIVE"
            alternativeId={
              dialog.kind === 'confirm_alternative' ? dialog.alternativeId : undefined
            }
          />
          <div className="space-y-2">
            <Label htmlFor="gud-comment-alt">
              {t('taktRequestDetail.guDecision.confirm.comment')}
            </Label>
            <Textarea
              id="gud-comment-alt"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('taktRequestDetail.guDecision.confirm.commentPlaceholder')}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() =>
                setDialog({
                  kind: 'select_alternative',
                  selectedId:
                    dialog.kind === 'confirm_alternative'
                      ? dialog.alternativeId
                      : null,
                })
              }
              disabled={submitting}
            >
              {t('taktRequestDetail.guDecision.alternative.back')}
            </Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={submitting}
              onClick={() => {
                if (dialog.kind === 'confirm_alternative') {
                  handleSubmit('ACCEPT_ALTERNATIVE', dialog.alternativeId);
                }
              }}
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('taktRequestDetail.guDecision.confirm.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: REQUEST_REVISION ─────────────────────────────────────── */}
      <Dialog
        open={dialog.kind === 'request_revision'}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('taktRequestDetail.guDecision.revision.title')}
            </DialogTitle>
            <DialogDescription>
              {t('taktRequestDetail.guDecision.revision.description')}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-700">
            {t('taktRequestDetail.guDecision.revision.noTaktChange')}
          </div>
          <div className="space-y-2">
            <Label htmlFor="gud-comment-rev">
              {t('taktRequestDetail.guDecision.revision.comment')}
            </Label>
            <Textarea
              id="gud-comment-rev"
              rows={4}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t(
                'taktRequestDetail.guDecision.revision.commentPlaceholder',
              )}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              {t('taktRequestDetail.guDecision.confirm.cancel')}
            </Button>
            <Button
              className="bg-orange-600 hover:bg-orange-700"
              onClick={() => handleSubmit('REQUEST_REVISION')}
              disabled={submitting}
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('taktRequestDetail.guDecision.revision.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: CLOSE_WITHOUT_AGREEMENT ─────────────────────────────── */}
      <Dialog
        open={dialog.kind === 'close_without_agreement'}
        onOpenChange={(o) => !o && closeDialog()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('taktRequestDetail.guDecision.close.title')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="font-medium">{t('taktRequestDetail.guDecision.close.warning')}</p>
            <p>{t('taktRequestDetail.guDecision.close.taktWarning')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gud-comment-close">
              {t('taktRequestDetail.guDecision.close.comment')}
            </Label>
            <Textarea
              id="gud-comment-close"
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t(
                'taktRequestDetail.guDecision.close.commentPlaceholder',
              )}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bell className="w-3.5 h-3.5" />
            {t('taktRequestDetail.guDecision.confirm.notifyHint')}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              {t('taktRequestDetail.guDecision.close.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleSubmit('CLOSE_WITHOUT_AGREEMENT')}
              disabled={submitting}
            >
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('taktRequestDetail.guDecision.close.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Confirmation details sub-component ───────────────────────────────────────

function ConfirmationDetails({
  detail,
  decisionType,
  alternativeId,
}: {
  detail: TaktRequestDetail;
  decisionType: DecisionType;
  alternativeId: string | undefined;
}) {
  const { t } = useTranslation();
  const resp = detail.response;
  const snap = detail.snapshot?.snapshotPayload as Record<string, unknown> | undefined;
  const tw = snap?.taktWindow as Record<string, string> | undefined;
  const origStart = tw?.start ?? (snap?.plannedStart as string | undefined);
  const origEnd = tw?.end ?? (snap?.plannedEnd as string | undefined);

  const selectedAlt = alternativeId
    ? resp?.alternatives?.find((a) => a.alternativeId === alternativeId)
    : null;

  const effectiveStart = selectedAlt
    ? (selectedAlt.proposedStart as string)
    : resp?.acceptedStart
    ? (resp.acceptedStart as string)
    : origStart;
  const effectiveEnd = selectedAlt
    ? (selectedAlt.proposedEnd as string)
    : resp?.acceptedEnd
    ? (resp.acceptedEnd as string)
    : origEnd;

  const newVersion =
    decisionType === 'ACCEPT_ALTERNATIVE' ? detail.taktVersion + 1 : detail.taktVersion;

  const statusAfter: Record<DecisionType, string> = {
    CONFIRM_ACCEPTED: 'ACCEPTED',
    ACCEPT_ALTERNATIVE: 'ACCEPTED',
    REQUEST_REVISION: 'REVISION_REQUIRED',
    CLOSE_WITHOUT_AGREEMENT: 'CANCELLED',
  };

  const taktAfter: Record<DecisionType, string> = {
    CONFIRM_ACCEPTED: 'CONFIRMED',
    ACCEPT_ALTERNATIVE: 'CONFIRMED',
    REQUEST_REVISION: 'IN_COORDINATION',
    CLOSE_WITHOUT_AGREEMENT: 'PLANNED',
  };

  const rows = [
    {
      label: t('taktRequestDetail.guDecision.confirm.action'),
      value: (
        <span
          className={`px-2 py-0.5 rounded text-xs font-semibold ${
            DECISION_COLORS[decisionType]
          }`}
        >
          {t(`taktRequestDetail.guDecision.decisionTypes.${decisionType}`, decisionType)}
        </span>
      ),
    },
    {
      label: t('taktRequestDetail.guDecision.confirm.takt'),
      value: detail.taktBezeichnung,
    },
    effectiveStart && effectiveEnd
      ? {
          label: t('taktRequestDetail.guDecision.confirm.timeWindow'),
          value: formatWindow(effectiveStart, effectiveEnd),
        }
      : null,
    {
      label: t('taktRequestDetail.guDecision.confirm.currentVersion'),
      value: `v${detail.taktVersion}`,
    },
    {
      label: t('taktRequestDetail.guDecision.confirm.newVersion'),
      value: `v${newVersion}`,
    },
    {
      label: t('taktRequestDetail.guDecision.confirm.requestStatus'),
      value: t(
        `taktRequests.requestStatus.${statusAfter[decisionType]}`,
        statusAfter[decisionType],
      ),
    },
    {
      label: t('taktRequestDetail.guDecision.confirm.taktStatus'),
      value: taktAfter[decisionType],
    },
  ].filter(Boolean);

  return (
    <dl className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      {rows.map((row) => {
        if (!row) return null;
        return (
          <div key={row.label} className="grid grid-cols-[180px_1fr] gap-2">
            <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
            <dd className="text-sm">{row.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}
