/**
 * DeadlineStatusBadge — Task 7.7
 *
 * Shows the current deadline urgency for a TaktRequest as a compact badge.
 * Separates temporal (deadline) status from business (request) status and
 * technical (message) status — do not merge these visually.
 *
 * Accessibility: always includes an aria-label and a textual indicator in
 * addition to colour so screen readers and colour-blind users are not excluded.
 */
import { Clock, AlertTriangle, CheckCircle, XCircle, Timer } from 'lucide-react';
import { classifyDeadline, type DeadlineKind } from '@/lib/deadline-utils';

interface DeadlineStatusBadgeProps {
  responseRequiredBy?: string | null;
  expiresAt?: string | null;
  expiredAt?: string | null;
  guDecisionRequiredBy?: string | null;
  className?: string;
  /** Use compact size in table rows. Default: false */
  compact?: boolean;
}

const kindStyles: Record<DeadlineKind, string> = {
  expired:              'bg-muted/60 text-muted-foreground',
  overdue:              'bg-red-500/10 text-red-600 border border-red-200',
  'due-today':          'bg-red-500/10 text-red-600 border border-red-200',
  'due-soon':           'bg-amber-500/10 text-amber-600 border border-amber-200',
  'gu-decision-overdue':'bg-orange-500/10 text-orange-600 border border-orange-200',
  'gu-decision-due-soon':'bg-orange-500/10 text-orange-600 border border-orange-200',
  ok:                   'bg-background border border-border text-muted-foreground',
  none:                 '',
};

const KindIcon: React.FC<{ kind: DeadlineKind; size: number }> = ({ kind, size }) => {
  switch (kind) {
    case 'expired':              return <XCircle size={size} aria-hidden />;
    case 'overdue':              return <AlertTriangle size={size} aria-hidden />;
    case 'due-today':            return <AlertTriangle size={size} aria-hidden />;
    case 'due-soon':             return <Clock size={size} aria-hidden />;
    case 'gu-decision-overdue':  return <AlertTriangle size={size} aria-hidden />;
    case 'gu-decision-due-soon': return <Timer size={size} aria-hidden />;
    case 'ok':                   return <CheckCircle size={size} aria-hidden />;
    default:                     return null;
  }
};

export function DeadlineStatusBadge({
  responseRequiredBy,
  expiresAt,
  expiredAt,
  guDecisionRequiredBy,
  className = '',
  compact = false,
}: DeadlineStatusBadgeProps) {
  const info = classifyDeadline({ responseRequiredBy, expiresAt, expiredAt, guDecisionRequiredBy });

  if (info.kind === 'none') {
    return <span className="text-muted-foreground text-xs">–</span>;
  }

  const iconSize = compact ? 10 : 12;
  const textSize = compact ? 'text-[11px]' : 'text-xs';
  const padding  = compact ? 'px-1.5 py-0 ' : 'px-2 py-0.5';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${textSize} ${padding} ${kindStyles[info.kind]} ${className}`}
      aria-label={info.ariaLabel}
      title={`${info.ariaLabel} (${info.dateLabel})`}
    >
      <KindIcon kind={info.kind} size={iconSize} />
      {info.label}
    </span>
  );
}
