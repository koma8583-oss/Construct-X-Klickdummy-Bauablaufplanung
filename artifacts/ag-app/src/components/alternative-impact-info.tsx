import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import type { AlternativeImpact } from '@/lib/alternative-impact';

interface AlternativeImpactInfoProps {
  impacts: AlternativeImpact[];
  taktNameById: Map<string, string>;
  className?: string;
}

function displayDate(value: string): string {
  return format(new Date(value), 'dd.MM.yyyy');
}

export function AlternativeImpactInfo({ impacts, taktNameById, className = '' }: AlternativeImpactInfoProps) {
  if (impacts.length === 0) {
    return (
      <div className={`flex items-start gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 ${className}`}>
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Keine Abhängigkeit ohne ausreichenden Puffer betroffen.</span>
      </div>
    );
  }

  return (
    <div className={`space-y-2 rounded-md border border-amber-500/35 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 ${className}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="font-semibold">Abhängigkeit betroffen — manuelle Prüfung erforderlich</span>
      </div>
      <div className="space-y-1.5">
        {impacts.map((impact, index) => {
          const isPredecessor = impact.direction === 'PREDECESSOR';
          return (
            <div key={`${impact.dependencyId}-${index}`} className="flex items-start gap-1.5">
              {isPredecessor
                ? <ArrowLeft className="mt-0.5 h-3 w-3 shrink-0" />
                : <ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />}
              <span>
                {isPredecessor ? 'Vorgänger' : 'Nachfolger'}{' '}
                <strong>{taktNameById.get(impact.relatedTaktId) ?? impact.relatedTaktId}</strong>{' '}
                ({impact.type}, Puffer {impact.lagDays > 0 ? `+${impact.lagDays}` : '0'}d):{' '}
                {isPredecessor
                  ? `müsste spätestens am ${displayDate(impact.requiredEnd)} enden`
                  : `müsste frühestens am ${displayDate(impact.requiredStart)} beginnen`}{' '}
                (Vorschlag {displayDate(impact.proposedStart)}–{displayDate(impact.proposedEnd)}).
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}