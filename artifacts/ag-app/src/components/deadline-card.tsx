/**
 * DeadlineCard — Task 7.7
 *
 * Detail page component showing all deadline-related fields in a structured card.
 * Three-tier status model: business status | deadline status | technical status
 * are kept visually separate.
 *
 * Accessibility: timestamps always shown as full date+time strings, not just
 * relative values, so users with cognitive impairments have the concrete date.
 */
import { Calendar, Clock, Bell, AlertTriangle, Timer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { classifyDeadline, formatDateTime } from '@/lib/deadline-utils';
import { DeadlineStatusBadge } from './deadline-status-badge';

interface DeadlineCardProps {
  responseRequiredBy?: string | Date | null;
  expiresAt?: string | Date | null;
  expiredAt?: string | Date | null;
  lastReminderAt?: string | Date | null;
  reminderCount?: number | null;
  guDecisionRequiredBy?: string | Date | null;
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : v;
}

function Row({
  icon: Icon,
  label,
  value,
  highlight,
}: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border/50 last:border-0">
      <div className={`flex items-center gap-2 text-sm ${highlight ? 'font-medium' : 'text-muted-foreground'}`}>
        <Icon size={14} className="flex-shrink-0" aria-hidden />
        {label}
      </div>
      <div className="text-sm text-right">{value ?? <span className="text-muted-foreground">–</span>}</div>
    </div>
  );
}

export function DeadlineCard({
  responseRequiredBy,
  expiresAt,
  expiredAt,
  lastReminderAt,
  reminderCount,
  guDecisionRequiredBy,
}: DeadlineCardProps) {
  const info = classifyDeadline({
    responseRequiredBy: toIso(responseRequiredBy),
    expiresAt: toIso(expiresAt),
    expiredAt: toIso(expiredAt),
    guDecisionRequiredBy: toIso(guDecisionRequiredBy),
  });

  const hasDueFields = responseRequiredBy || expiresAt || expiredAt || guDecisionRequiredBy;
  if (!hasDueFields && !reminderCount) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar size={15} aria-hidden />
          Fristen &amp; Erinnerungen
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Deadline status summary */}
        {info.kind !== 'none' && (
          <div className="mb-3 pb-3 border-b border-border/50">
            <div className="text-xs text-muted-foreground mb-1">Friststatus</div>
            <DeadlineStatusBadge
              responseRequiredBy={toIso(responseRequiredBy)}
              expiresAt={toIso(expiresAt)}
              expiredAt={toIso(expiredAt)}
              guDecisionRequiredBy={toIso(guDecisionRequiredBy)}
            />
          </div>
        )}

        <div className="space-y-0">
          {responseRequiredBy && (
            <Row
              icon={Clock}
              label="Antwortfrist"
              value={formatDateTime(new Date(responseRequiredBy))}
              highlight={info.kind === 'overdue' || info.kind === 'due-today' || info.kind === 'due-soon'}
            />
          )}
          {(expiresAt || expiredAt) && (
            <Row
              icon={AlertTriangle}
              label="Ablaufzeitpunkt"
              value={
                expiredAt
                  ? <span className="text-muted-foreground">{formatDateTime(new Date(expiredAt))} (abgelaufen)</span>
                  : <span className={info.kind === 'expired' ? 'text-muted-foreground' : ''}>
                      {formatDateTime(new Date(expiresAt!))}
                    </span>
              }
              highlight={info.kind === 'expired'}
            />
          )}
          {guDecisionRequiredBy && (
            <Row
              icon={Timer}
              label="GU-Entscheidungsfrist"
              value={formatDateTime(new Date(guDecisionRequiredBy))}
              highlight={info.kind === 'gu-decision-overdue' || info.kind === 'gu-decision-due-soon'}
            />
          )}
          {lastReminderAt && (
            <Row
              icon={Bell}
              label="Letzte Erinnerung"
              value={formatDateTime(new Date(lastReminderAt))}
            />
          )}
          {typeof reminderCount === 'number' && (
            <Row
              icon={Bell}
              label="Erinnerungen gesamt"
              value={`${reminderCount}× versendet`}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
