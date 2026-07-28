import { TaktStatus } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";

const STATUS_CONFIG: Record<TaktStatus, { label: string; className: string }> = {
  GEPLANT:    { label: "Geplant",        className: "border-slate-500/50 text-slate-400" },
  VERGEBEN:   { label: "Vergeben",       className: "border-amber-500/50 text-amber-500" },
  ALTERNATIV: { label: "Gegenvorschlag", className: "border-blue-500/50 text-blue-500" },
  BESTAETIGT: { label: "Bestätigt",      className: "border-emerald-500/50 text-emerald-500" },
  ABGELEHNT:  { label: "Abgelehnt",      className: "border-red-500/50 text-red-500" },
  STORNIERT:  { label: "Storniert",      className: "border-slate-400/50 text-slate-400" },
};

interface TaktStatusBadgeProps {
  status?: TaktStatus | null;
}

export function TaktStatusBadge({ status }: TaktStatusBadgeProps) {
  if (!status) return null;
  const cfg = STATUS_CONFIG[status];
  if (!cfg) return null;
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}
