/**
 * Ressourcenbelegungen — NU-only page.
 * Route: /resource-bookings
 *
 * Shows all resource bookings for the authenticated AN's organisation,
 * grouped and filterable by source type and status. Highlights
 * utilisation > 100% in red. Create, cancel, and permanently delete
 * (CANCELLED only) bookings in-page.
 *
 * Time is optional when creating a booking — leaving it blank means
 * the whole day (00:00–23:59).
 */
import { useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  useListNuResourceBookings,
  useCancelNuResourceBooking,
  useCreateNuResourceBooking,
  useDeleteNuResourceBooking,
  useListNuLocalProjects,
  useListResources,
  getListNuResourceBookingsQueryKey,
  type NuResourceBooking,
  type NuResourceBookingCreate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Plus,
  XCircle,
  Trash2,
  Loader2,
  AlertTriangle,
  RefreshCw,
  X,
  CheckCircle,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// ── Labels ─────────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  LOCAL_PROJECT: "Lokales Projekt",
  TAKT_REQUEST: "TaktAnfrage",
  MANUAL_BLOCK: "Manueller Block",
  ABSENCE: "Abwesenheit",
  MAINTENANCE: "Wartung",
};

const SOURCE_STYLES: Record<string, string> = {
  LOCAL_PROJECT: "text-blue-600 bg-blue-500/10",
  TAKT_REQUEST: "text-purple-600 bg-purple-500/10",
  MANUAL_BLOCK: "text-amber-600 bg-amber-500/10",
  ABSENCE: "text-orange-600 bg-orange-500/10",
  MAINTENANCE: "text-slate-600 bg-slate-500/10",
};

const STATUS_LABELS: Record<string, string> = {
  TENTATIVE: "Vorläufig",
  CONFIRMED: "Bestätigt",
  CANCELLED: "Storniert",
};

const STATUS_STYLES: Record<string, string> = {
  TENTATIVE: "text-amber-600 bg-amber-500/10",
  CONFIRMED: "text-emerald-600 bg-emerald-500/10",
  CANCELLED: "text-muted-foreground bg-muted/50",
};

function SourceBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${SOURCE_STYLES[type] ?? "bg-muted text-muted-foreground"}`}>
      {SOURCE_LABELS[type] ?? type}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── Date/time helpers ──────────────────────────────────────────────────────────

/** Returns true when startAt is midnight and endAt is 23:59 on the same date. */
function isAllDay(startAt: string, endAt: string): boolean {
  try {
    const s = new Date(startAt);
    const e = new Date(endAt);
    return (
      s.getHours() === 0 &&
      s.getMinutes() === 0 &&
      s.getSeconds() === 0 &&
      e.getHours() === 23 &&
      e.getMinutes() === 59 &&
      s.toDateString() === e.toDateString()
    );
  } catch {
    return false;
  }
}

function fmtDate(s?: string | null): string {
  if (!s) return "–";
  try { return format(new Date(s), "dd.MM.yyyy", { locale: de }); } catch { return s; }
}

function fmtDt(s?: string | null): string {
  if (!s) return "–";
  try { return format(new Date(s), "dd.MM.yy HH:mm", { locale: de }); } catch { return s; }
}

/**
 * Converts a (date, time) pair from the form into an ISO string.
 * If time is empty, uses startOfDay (00:00:00) or endOfDay (23:59:59).
 */
function buildIso(date: string, time: string, isEnd: boolean): string {
  if (!time) {
    return new Date(`${date}T${isEnd ? "23:59:59" : "00:00:00"}`).toISOString();
  }
  // time value from <input type="time"> is "HH:mm"
  return new Date(`${date}T${time}:00`).toISOString();
}

// ── Create booking dialog ──────────────────────────────────────────────────────

interface BookingFormData {
  resourceId: string;
  localProjectId: string;
  sourceType: string;
  startDate: string;
  startTime: string; // optional — empty means 00:00 (all-day start)
  endDate: string;
  endTime: string;   // optional — empty means 23:59 (all-day end)
  utilizationPercent: number;
  status: string;
  note: string;
}

const EMPTY_BOOKING: BookingFormData = {
  resourceId: "",
  localProjectId: "",
  sourceType: "MANUAL_BLOCK",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  utilizationPercent: 100,
  status: "TENTATIVE",
  note: "",
};

function CreateBookingDialog({
  open,
  onClose,
  onSave,
  isSaving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: BookingFormData) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<BookingFormData>(EMPTY_BOOKING);

  const { data: resources } = useListResources();
  const { data: localProjects } = useListNuLocalProjects();

  const set = (field: keyof BookingFormData, value: string | number) =>
    setForm((f) => ({ ...f, [field]: value }));

  const canSave =
    form.resourceId !== "" &&
    form.startDate !== "" &&
    form.endDate !== "" &&
    form.utilizationPercent > 0;

  const handleClose = () => { onClose(); setForm(EMPTY_BOOKING); };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Neue Belegung anlegen</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Ressource *</Label>
              <Select value={form.resourceId} onValueChange={(v) => set("resourceId", v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Ressource wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {(resources ?? []).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Art</Label>
              <Select value={form.sourceType} onValueChange={(v) => set("sourceType", v)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SOURCE_LABELS).filter(([k]) => k !== "TAKT_REQUEST").map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).filter(([k]) => k !== "CANCELLED").map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {form.sourceType === "LOCAL_PROJECT" && (localProjects?.items?.length ?? 0) > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Lokales Projekt</Label>
              <Select value={form.localProjectId} onValueChange={(v) => set("localProjectId", v)}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Projekt wählen (optional)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Kein Projekt</SelectItem>
                  {(localProjects?.items ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.displayName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Date + optional time rows */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Datum Von *</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  Uhrzeit Von
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <Input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => set("startTime", e.target.value)}
                    className="h-9"
                    placeholder="ganztägig"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Datum Bis *</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) => set("endDate", e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1">
                  Uhrzeit Bis
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <Input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => set("endTime", e.target.value)}
                    className="h-9"
                    placeholder="ganztägig"
                  />
                </div>
              </div>
            </div>
            {(!form.startTime || !form.endTime) && (
              <p className="text-xs text-muted-foreground">
                Ohne Uhrzeit wird die Belegung für den gesamten Tag eingetragen (00:00–23:59).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Auslastung (%)</Label>
            <Input
              type="number"
              min={1}
              max={100}
              value={form.utilizationPercent}
              onChange={(e) => set("utilizationPercent", Number(e.target.value))}
              className="h-9 w-32"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notiz</Label>
            <Input value={form.note} onChange={(e) => set("note", e.target.value)} className="h-9" placeholder="Optional…" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={handleClose}>
              <X className="w-4 h-4 mr-1.5" />
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(form)}
              disabled={!canSave || isSaving}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {isSaving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1.5" />}
              Anlegen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ResourceBookingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [sourceFilter, setSourceFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [startFrom, setStartFrom] = useState<string>("");
  const [endTo, setEndTo]     = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);

  const queryParams: Record<string, unknown> = {
    ...(sourceFilter !== "ALL" && { sourceType: sourceFilter }),
    ...(statusFilter !== "ALL" && { status: statusFilter }),
    ...(startFrom && { startFrom: new Date(startFrom).toISOString() }),
    ...(endTo   && { endTo:   new Date(endTo).toISOString() }),
    limit: 100,
  };

  const { data, isLoading, isError, refetch } = useListNuResourceBookings(queryParams as Parameters<typeof useListNuResourceBookings>[0]);
  const { data: resources } = useListResources();
  const cancelMutation = useCancelNuResourceBooking();
  const deleteMutation = useDeleteNuResourceBooking();
  const createMutation = useCreateNuResourceBooking();

  const resourceNameById = (id?: string | null) =>
    id ? (resources?.find((r) => r.id === id)?.name ?? id.slice(0, 8) + "…") : "–";

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListNuResourceBookingsQueryKey() });

  const handleCancel = async (b: NuResourceBooking) => {
    if (!confirm(`Belegung vom ${fmtDt(b.startAt)} stornieren?`)) return;
    try {
      await cancelMutation.mutateAsync({ bookingId: b.id });
      invalidate();
      toast({ title: "Belegung storniert" });
    } catch {
      toast({ title: "Fehler", variant: "destructive" });
    }
  };

  const handleDelete = async (b: NuResourceBooking) => {
    if (!confirm(`Stornierte Belegung vom ${fmtDate(b.startAt)} endgültig löschen? Diese Aktion kann nicht rückgängig gemacht werden.`)) return;
    try {
      await deleteMutation.mutateAsync({ bookingId: b.id });
      invalidate();
      toast({ title: "Belegung gelöscht" });
    } catch {
      toast({ title: "Fehler beim Löschen", variant: "destructive" });
    }
  };

  const handleCreate = async (form: BookingFormData) => {
    const body: NuResourceBookingCreate = {
      resourceId: form.resourceId,
      sourceType: form.sourceType as NuResourceBookingCreate["sourceType"],
      startAt: buildIso(form.startDate, form.startTime, false),
      endAt:   buildIso(form.endDate, form.endTime, true),
      utilizationPercent: form.utilizationPercent,
      status: form.status as NuResourceBookingCreate["status"],
      ...(form.localProjectId && { localProjectId: form.localProjectId }),
      ...(form.note && { note: form.note }),
    };
    try {
      await createMutation.mutateAsync({ data: body });
      setCreateOpen(false);
      invalidate();
      toast({ title: "Belegung angelegt" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Fehler";
      toast({ title: "Fehler", description: msg, variant: "destructive" });
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Ressourcenbelegungen</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Alle Belegungen Ihrer Ressourcen — intern und aus TaktAnfragen
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Neue Belegung
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-end">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Art</Label>
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 w-full sm:w-[180px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Arten</SelectItem>
              {Object.entries(SOURCE_LABELS).map(([k, l]) => (
                <SelectItem key={k} value={k}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-full sm:w-[150px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Alle Status</SelectItem>
              {Object.entries(STATUS_LABELS).map(([k, l]) => (
                <SelectItem key={k} value={k}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Von</Label>
          <Input
            type="date"
            value={startFrom}
            onChange={(e) => setStartFrom(e.target.value)}
            className="h-8 w-full sm:w-[140px] text-sm"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Bis</Label>
          <Input
            type="date"
            value={endTo}
            onChange={(e) => setEndTo(e.target.value)}
            className="h-8 w-full sm:w-[140px] text-sm"
          />
        </div>

        {(sourceFilter !== "ALL" || statusFilter !== "ALL" || startFrom || endTo) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={() => { setSourceFilter("ALL"); setStatusFilter("ALL"); setStartFrom(""); setEndTo(""); }}
          >
            <X className="w-3.5 h-3.5 mr-1.5" />
            Filter zurücksetzen
          </Button>
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-4 py-20">
          <AlertTriangle className="w-10 h-10 text-destructive" />
          <p className="text-muted-foreground">Fehler beim Laden der Belegungen</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Erneut versuchen
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 border border-dashed rounded-xl">
          <CalendarDays className="w-12 h-12 text-muted-foreground opacity-40" />
          <p className="font-medium text-muted-foreground">Keine Belegungen gefunden</p>
        </div>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-xs">Ressource</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Art</TableHead>
                    <TableHead className="text-xs">Von</TableHead>
                    <TableHead className="text-xs">Bis</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Auslastung</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Notiz</TableHead>
                    <TableHead className="text-xs w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((b) => {
                    const overUtilised = b.utilizationPercent > 100;
                    const isCancelled  = b.status === "CANCELLED";
                    const allDay       = b.startAt && b.endAt ? isAllDay(b.startAt, b.endAt) : false;
                    return (
                      <TableRow
                        key={b.id}
                        className={`border-border hover:bg-muted/30 transition-colors ${isCancelled ? "opacity-50" : ""}`}
                      >
                        <TableCell className="font-medium text-sm">
                          {resourceNameById(b.resourceId)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <SourceBadge type={b.sourceType} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {allDay ? (
                            <span className="flex items-center gap-1">
                              {fmtDate(b.startAt)}
                              <span className="text-[10px] bg-muted px-1 rounded">Ganztägig</span>
                            </span>
                          ) : fmtDt(b.startAt)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {allDay ? "–" : fmtDt(b.endAt)}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className={`text-sm font-medium ${overUtilised ? "text-red-600" : "text-foreground"}`}>
                            {b.utilizationPercent}%
                            {overUtilised && <span className="ml-1 text-xs">(⚠️ Überbucht)</span>}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={b.status} />
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs text-muted-foreground max-w-[120px] truncate">
                          {b.note ?? "–"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-0.5">
                            {!isCancelled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                                title={
                                  b.sourceType === "TAKT_REQUEST"
                                    ? "Ressourcenreservierung stornieren (automatisch aus TaktAnfrage erstellt — die TaktAnfrage selbst bleibt unberührt)"
                                    : "Stornieren"
                                }
                                onClick={() => void handleCancel(b)}
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            {isCancelled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                title="Endgültig löschen"
                                onClick={() => void handleDelete(b)}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">{items.length} Einträge</p>

      <CreateBookingDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={(form) => void handleCreate(form)}
        isSaving={createMutation.isPending}
      />
    </div>
  );
}
