/**
 * RevisionDialog — Task 6.8
 *
 * Shown when a TaktRequest is in REVISION_REQUIRED status.
 * Allows the GU planner to:
 *   1. Set a new planned time window for the Takt
 *   2. Update subject, message, and response deadline
 *   3. Save as draft (sendImmediately=false) or send immediately
 *
 * Shows a before/after comparison of the time window with changed fields highlighted.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import {
  Send,
  Save,
  Loader2,
  ChevronRight,
  GitBranch,
} from 'lucide-react';
import {
  useCreateRevision,
  getGetTaktRequestDetailQueryKey,
  type TaktRequestDetail,
  type RevisionResponse,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { DatePicker } from '@/components/date-picker';

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RevisionDialogProps {
  detail: TaktRequestDetail;
  open: boolean;
  onClose: () => void;
  onSuccess?: (result: RevisionResponse) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalDatetimeString(d: string | Date | null | undefined): string {
  if (!d) return '';
  const date = typeof d === 'string' ? new Date(d) : d;
  // Format for datetime-local input: "YYYY-MM-DDTHH:mm"
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function displayDate(s: string): string {
  if (!s) return '—';
  try {
    return format(new Date(s), 'dd.MM.yyyy HH:mm');
  } catch {
    return s;
  }
}

function CompareRow({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}) {
  return (
    <tr className={`border-b border-border/40 ${changed ? 'bg-amber-50/60' : ''}`}>
      <td className="py-2 pr-4 text-sm font-medium text-muted-foreground whitespace-nowrap">
        {label}
      </td>
      <td className="py-2 pr-4 text-sm font-mono">{before || '—'}</td>
      <td className="py-2 text-sm font-mono">
        {changed ? (
          <span className="font-semibold text-amber-700">{after || '—'}</span>
        ) : (
          after || '—'
        )}
      </td>
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function RevisionDialog({ detail, open, onClose, onSuccess }: RevisionDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  const { mutateAsync: createRevision } = useCreateRevision();

  // ── Snapshot-based defaults ───────────────────────────────────────────────
  const snap = detail.snapshot?.snapshotPayload as Record<string, unknown> | undefined;
  const tw = snap?.taktWindow as Record<string, string> | undefined;
  const snapStart = tw?.start ?? (snap?.plannedStart as string | undefined) ?? '';
  const snapEnd = tw?.end ?? (snap?.plannedEnd as string | undefined) ?? '';
  const snapSubject = (snap?.coordinationContext as Record<string, unknown> | undefined)
    ?.subject as string | undefined;
  const snapMessage = (snap?.coordinationContext as Record<string, unknown> | undefined)
    ?.message as string | undefined;

  // ── Form state ────────────────────────────────────────────────────────────
  const [plannedStart, setPlannedStart] = useState(toLocalDatetimeString(snapStart));
  const [plannedEnd, setPlannedEnd] = useState(toLocalDatetimeString(snapEnd));
  const [responseRequiredBy, setResponseRequiredBy] = useState('');
  const [subject, setSubject] = useState(snapSubject ?? '');
  const [message, setMessage] = useState(snapMessage ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<RevisionResponse | null>(null);

  const startChanged = plannedStart !== toLocalDatetimeString(snapStart);
  const endChanged = plannedEnd !== toLocalDatetimeString(snapEnd);
  const timeWindowChanged =
    plannedStart.slice(0, 10) !== snapStart.slice(0, 10) ||
    plannedEnd.slice(0, 10) !== snapEnd.slice(0, 10);
  const timeWindowValid =
    !!plannedStart &&
    !!plannedEnd &&
    plannedEnd > plannedStart &&
    timeWindowChanged;
  const subjectChanged = subject !== (snapSubject ?? '');
  const messageChanged = message !== (snapMessage ?? '');

  const handleSubmit = async (sendImmediately: boolean) => {
    if (!timeWindowValid) {
      setError(
        !plannedStart || !plannedEnd
          ? 'Bitte definieren Sie ein neues Zeitfenster.'
          : plannedEnd <= plannedStart
            ? 'Das Ende des Zeitfensters muss nach dem Start liegen.'
            : 'Bitte ändern Sie das Zeitfenster gegenüber der bisherigen Anfrage.',
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createRevision({
        requestId: detail.id,
        data: {
          plannedTimeWindow: {
            start: plannedStart,
            end: plannedEnd,
          },
          responseRequiredBy: responseRequiredBy || null,
          subject: subject || null,
          message: message || null,
          sendImmediately,
        },
      });
      setSuccessResult(result);
      onSuccess?.(result);
      await queryClient.invalidateQueries({
        queryKey: getGetTaktRequestDetailQueryKey(detail.id),
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Fehler beim Erstellen der neuen Version';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNavigateToNew = () => {
    if (successResult?.newRequestId) {
      onClose();
      navigate(`/takt-requests/${successResult.newRequestId}`);
    }
  };

  // ── Success view ──────────────────────────────────────────────────────────
  if (successResult) {
    return (
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('taktRequestDetail.revisionDialog.success.title')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <dl className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
              <div className="grid grid-cols-[160px_1fr] gap-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t('taktRequestDetail.revisionDialog.success.newRequest')}
                </dt>
                <dd className="text-sm font-mono">{successResult.newRequestNumber}</dd>
              </div>
              <div className="grid grid-cols-[160px_1fr] gap-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t('taktRequestDetail.revisionDialog.success.newVersion')}
                </dt>
                <dd className="text-sm">v{successResult.newTaktVersion}</dd>
              </div>
              <div className="grid grid-cols-[160px_1fr] gap-2">
                <dt className="text-xs font-medium text-muted-foreground">
                  {t('taktRequestDetail.revisionDialog.success.sent')}
                </dt>
                <dd className="text-sm">
                  {successResult.sent ? (
                    <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">
                      {t('taktRequestDetail.revisionDialog.success.sentYes')}
                    </Badge>
                  ) : (
                    <Badge variant="outline">
                      {t('taktRequestDetail.revisionDialog.success.sentNo')}
                    </Badge>
                  )}
                </dd>
              </div>
            </dl>
            <Button className="w-full" onClick={handleNavigateToNew}>
              <ChevronRight className="w-4 h-4 mr-2" />
              {t('taktRequestDetail.revisionDialog.success.openNew')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // ── Edit view ─────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('taktRequestDetail.revisionDialog.title')}
          </DialogTitle>
          <DialogDescription>
            {t('taktRequestDetail.revisionDialog.description')}
          </DialogDescription>
        </DialogHeader>

        {/* ── Context ──────────────────────────────────────────────────── */}
        <div className="rounded-md bg-muted/30 border border-border p-3 space-y-1 text-sm">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t('taktRequestDetail.revisionDialog.context')}
          </p>
          <p>
            <span className="text-muted-foreground">
              {t('taktRequestDetail.guDecision.confirm.takt')}:{' '}
            </span>
            <span className="font-medium">{detail.taktBezeichnung}</span>
          </p>
          {detail.response?.comment && (
            <p className="text-muted-foreground italic">
              {t('taktRequestDetail.revisionDialog.nuComment')}: {detail.response.comment}
            </p>
          )}
          {detail.guDecision?.comment && (
            <p className="text-amber-700 italic">
              {t('taktRequestDetail.revisionDialog.guComment')}: {detail.guDecision.comment}
            </p>
          )}
        </div>

        <Separator />

        {/* ── Editable fields ───────────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rev-start">
                {t('taktRequestDetail.revisionDialog.fields.plannedStart')}
                <span className="text-destructive ml-1">*</span>
              </Label>
              <DatePicker
                id="rev-start"
                includeTime
                value={plannedStart}
                onChange={setPlannedStart}
                className={startChanged ? 'border-amber-400 bg-amber-50' : ''}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rev-end">
                {t('taktRequestDetail.revisionDialog.fields.plannedEnd')}
                <span className="text-destructive ml-1">*</span>
              </Label>
              <DatePicker
                id="rev-end"
                includeTime
                value={plannedEnd}
                onChange={setPlannedEnd}
                className={endChanged ? 'border-amber-400 bg-amber-50' : ''}
              />
            </div>
          </div>
          {!timeWindowValid && plannedStart && plannedEnd && (
            <p className="text-sm text-destructive">
              {plannedEnd <= plannedStart
                ? 'Das Ende des Zeitfensters muss nach dem Start liegen.'
                : 'Für die Überarbeitung muss ein neues Zeitfenster definiert werden.'}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="rev-deadline">
              {t('taktRequestDetail.revisionDialog.fields.responseRequiredBy')}
            </Label>
            <DatePicker
              id="rev-deadline"
              includeTime
              value={responseRequiredBy}
              onChange={setResponseRequiredBy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev-subject">
              {t('taktRequestDetail.revisionDialog.fields.subject')}
            </Label>
            <Input
              id="rev-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={subjectChanged ? 'border-amber-400 bg-amber-50' : ''}
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rev-message">
              {t('taktRequestDetail.revisionDialog.fields.message')}
            </Label>
            <Textarea
              id="rev-message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className={messageChanged ? 'border-amber-400 bg-amber-50' : ''}
              maxLength={4000}
            />
          </div>
        </div>

        {/* ── Comparison table ──────────────────────────────────────────── */}
        {(startChanged || endChanged || subjectChanged || messageChanged) && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-sm font-medium">
                {t('taktRequestDetail.revisionDialog.comparison.title')}
              </p>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-1.5 pr-4 w-40">
                      {t('taktRequestDetail.revisionDialog.comparison.field')}
                    </th>
                    <th className="text-left py-1.5 pr-4">
                      {t('taktRequestDetail.revisionDialog.comparison.before')}
                    </th>
                    <th className="text-left py-1.5">
                      {t('taktRequestDetail.revisionDialog.comparison.after')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow
                    label={t('taktRequestDetail.revisionDialog.fields.plannedStart')}
                    before={displayDate(toLocalDatetimeString(snapStart))}
                    after={displayDate(plannedStart)}
                    changed={startChanged}
                  />
                  <CompareRow
                    label={t('taktRequestDetail.revisionDialog.fields.plannedEnd')}
                    before={displayDate(toLocalDatetimeString(snapEnd))}
                    after={displayDate(plannedEnd)}
                    changed={endChanged}
                  />
                  {(subjectChanged) && (
                    <CompareRow
                      label={t('taktRequestDetail.revisionDialog.fields.subject')}
                      before={snapSubject ?? ''}
                      after={subject}
                      changed={subjectChanged}
                    />
                  )}
                  {(messageChanged) && (
                    <CompareRow
                      label={t('taktRequestDetail.revisionDialog.fields.message')}
                      before={snapMessage ?? ''}
                      after={message}
                      changed={messageChanged}
                    />
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Data sharing notice ───────────────────────────────────────── */}
        <div className="rounded-md bg-blue-50 border border-blue-200 p-3 space-y-1 text-xs text-blue-700">
          <p className="font-medium">
            {t('taktRequestDetail.revisionDialog.dataSharing.title')}
          </p>
          <ul className="space-y-0.5 list-disc list-inside">
            <li>{t('taktRequestDetail.revisionDialog.dataSharing.notification')}</li>
            <li>{t('taktRequestDetail.revisionDialog.dataSharing.snapshot')}</li>
            <li className="text-blue-600">
              {t('taktRequestDetail.revisionDialog.dataSharing.internal')}
            </li>
          </ul>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t('taktRequestDetail.revisionDialog.cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleSubmit(false)}
            disabled={submitting || !timeWindowValid}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-2" />
            )}
            {t('taktRequestDetail.revisionDialog.submit')}
          </Button>
          <Button
            onClick={() => handleSubmit(true)}
            disabled={submitting || !timeWindowValid}
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            {t('taktRequestDetail.revisionDialog.submitAndSend')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Trigger button exported separately so the detail page can render it ───────

export interface RevisionTriggerProps {
  detail: TaktRequestDetail;
}

export function RevisionTrigger({ detail }: RevisionTriggerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (detail.status !== 'REVISION_REQUIRED') return null;

  return (
    <>
      <Button
        className="bg-orange-600 hover:bg-orange-700 text-white"
        onClick={() => setOpen(true)}
      >
        <GitBranch className="w-4 h-4 mr-2" />
        {t('taktRequestDetail.guDecision.revision.createNewVersion')}
      </Button>
      <RevisionDialog
        detail={detail}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
