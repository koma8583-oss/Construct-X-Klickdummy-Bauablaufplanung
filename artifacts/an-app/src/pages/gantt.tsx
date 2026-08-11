/**
 * Terminübersicht
 *   Tab 1 — Takttermine:      gantt-task-react (unchanged)
 *   Tab 2 — Ressourcenbelegung: custom Gantt
 *     • Three sections: Externe Projekte / Interne Projekte / Allgemeine Belegungen
 *     • Left column: name only (expandable groups, no From/To columns)
 *     • Click on bar → detail panel
 *     • All-day bookings (00:00–23:59) shown as full-day block
 */
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { format, differenceInCalendarDays, addDays, startOfMonth, endOfMonth } from "date-fns";
import { de } from "date-fns/locale";
import {
  useListTaktRequests,
  getListTaktRequestsQueryKey,
  useListNuResourceBookings,
  useListNuLocalProjects,
  useListResources,
  type NuResourceBooking,
  type NuLocalProject,
  type Resource,
} from "@workspace/api-client-react";
import { Gantt, ViewMode } from "gantt-task-react";
import type { Task } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  ChevronRight,
  ChevronDown,
  X,
  Building2,
  FolderOpen,
  Layers,
  CalendarDays,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Constants shared by both tabs
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  SENT: "#f59e0b", DELIVERED: "#f59e0b", DETAILS_RETRIEVED: "#f59e0b",
  UNDER_REVIEW: "#f59e0b", ACCEPTED: "#10b981", ALTERNATIVES_PROPOSED: "#3b82f6",
  REJECTED: "#ef4444", REVISION_REQUIRED: "#f97316", CANCELLED: "#9ca3af",
  EXPIRED: "#6b7280", SUPERSEDED: "#6b7280", DRAFT: "#d1d5db",
};

const STATUS_LABEL: Record<string, string> = {
  SENT: "Gesendet", DELIVERED: "Zugestellt", DETAILS_RETRIEVED: "Abgerufen",
  UNDER_REVIEW: "In Prüfung", ACCEPTED: "Angenommen",
  ALTERNATIVES_PROPOSED: "Gegenvorschlag", REJECTED: "Abgelehnt",
  REVISION_REQUIRED: "Überarbeitung", CANCELLED: "Storniert",
  EXPIRED: "Abgelaufen", SUPERSEDED: "Ersetzt", DRAFT: "Entwurf",
};

const BOOKING_STATUS_COLOR: Record<string, string> = {
  TENTATIVE: "#f59e0b", CONFIRMED: "#10b981", CANCELLED: "#9ca3af",
};

const BOOKING_STATUS_LABEL: Record<string, string> = {
  TENTATIVE: "Vorläufig", CONFIRMED: "Bestätigt", CANCELLED: "Storniert",
};

const SOURCE_TYPE_LABEL: Record<string, string> = {
  LOCAL_PROJECT: "Lokales Projekt", TAKT_REQUEST: "Taktauftrag",
  MANUAL_BLOCK: "Manuell blockiert", ABSENCE: "Abwesenheit", MAINTENANCE: "Wartung",
};

function safeEnd(start: Date, end: Date): Date {
  if (end <= start) { const d = new Date(start); d.setDate(d.getDate() + 1); return d; }
  return end;
}

const MS_PER_DAY = 86_400_000;

// ─────────────────────────────────────────────────────────────────────────────
// Custom Resource Gantt types
// ─────────────────────────────────────────────────────────────────────────────

interface EnrichedBooking extends NuResourceBooking {
  resourceName: string;
  sectionId: "external" | "internal" | "general";
  groupName: string;
}

interface GanttGroup { id: string; name: string; bookings: EnrichedBooking[] }

interface GanttSection {
  id: "external" | "internal" | "general";
  label: string;
  Icon: React.ElementType;
  accentColor: string;
  bgColor: string;
  groups: GanttGroup[];
}

type GanttRow =
  | { kind: "section"; section: GanttSection }
  | { kind: "group";   section: GanttSection; group: GanttGroup }
  | { kind: "booking"; section: GanttSection; group: GanttGroup; booking: EnrichedBooking };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isAllDay(startAt: string, endAt: string): boolean {
  try {
    const s = new Date(startAt); const e = new Date(endAt);
    return s.getHours() === 0 && s.getMinutes() === 0 && s.getSeconds() === 0 &&
           e.getHours() === 23 && e.getMinutes() === 59 &&
           s.toDateString() === e.toDateString();
  } catch { return false; }
}

function fmtDate(s?: string | null) {
  if (!s) return "–";
  try { return format(new Date(s), "dd.MM.yyyy", { locale: de }); } catch { return s; }
}

function fmtDt(s?: string | null) {
  if (!s) return "–";
  try { return format(new Date(s), "dd.MM.yyyy HH:mm", { locale: de }); } catch { return s; }
}

/** Pixels-per-day for each view mode */
function getPxPerDay(mode: ViewMode): number {
  if (mode === ViewMode.Day)  return 48;
  if (mode === ViewMode.Week) return 20;
  return 5; // Month
}

/** Build month segments for the header */
function buildMonthSegments(start: Date, end: Date, pxPerDay: number) {
  const segs: { left: number; width: number; label: string }[] = [];
  let cur = startOfMonth(start);
  while (cur < end) {
    const mEnd = endOfMonth(cur);
    const clampS = cur < start ? start : cur;
    const clampE = mEnd > end  ? end   : mEnd;
    const left  = differenceInCalendarDays(clampS, start) * pxPerDay;
    const width = (differenceInCalendarDays(clampE, clampS) + 1) * pxPerDay;
    segs.push({ left, width, label: format(cur, "MMMM yyyy", { locale: de }) });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return segs;
}

/** Build day/week tick marks for the sub-header */
function buildTicks(start: Date, end: Date, pxPerDay: number, mode: ViewMode) {
  const ticks: { left: number; label: string }[] = [];
  if (mode === ViewMode.Day) {
    let d = new Date(start); d.setHours(0, 0, 0, 0);
    while (d <= end) {
      ticks.push({ left: differenceInCalendarDays(d, start) * pxPerDay, label: String(d.getDate()) });
      d = addDays(d, 1);
    }
  } else if (mode === ViewMode.Week) {
    // Monday of each week
    let d = new Date(start);
    const dow = d.getDay(); // 0=Sun
    d.setDate(d.getDate() - ((dow + 6) % 7)); // go back to Monday
    d.setHours(0, 0, 0, 0);
    while (d <= end) {
      const left = differenceInCalendarDays(d, start) * pxPerDay;
      if (left >= 0) ticks.push({ left, label: format(d, "d. MMM", { locale: de }) });
      d = addDays(d, 7);
    }
  }
  // Month mode has no sub-ticks (months are wide enough)
  return ticks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────────────────────

function BookingDetail({
  booking,
  onClose,
}: {
  booking: EnrichedBooking;
  onClose: () => void;
}) {
  const allDay = isAllDay(booking.startAt, booking.endAt);
  return (
    <div className="border-t border-border bg-card px-5 py-4 animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-sm font-semibold">{booking.resourceName}</div>
          <div className="text-xs text-muted-foreground">
            {SOURCE_TYPE_LABEL[booking.sourceType] ?? booking.sourceType}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors mt-0.5"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">Zeitraum</div>
          <div className="font-medium">
            {allDay
              ? <span className="flex items-center gap-1">{fmtDate(booking.startAt)}<span className="text-xs bg-muted px-1 rounded">Ganztägig</span></span>
              : <>{fmtDt(booking.startAt)}<br /><span className="text-muted-foreground">bis </span>{fmtDt(booking.endAt)}</>
            }
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">Status</div>
          <div
            className="font-medium"
            style={{ color: BOOKING_STATUS_COLOR[booking.status] }}
          >
            {BOOKING_STATUS_LABEL[booking.status] ?? booking.status}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">Auslastung</div>
          <div className={`font-medium ${booking.utilizationPercent > 100 ? "text-red-600" : ""}`}>
            {booking.utilizationPercent}%
          </div>
        </div>
        {booking.note && (
          <div className="sm:col-span-1">
            <div className="text-xs text-muted-foreground mb-0.5">Notiz</div>
            <div className="text-sm">{booking.note}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom Resource Gantt component
// ─────────────────────────────────────────────────────────────────────────────

const ROW_H     = 36;   // px — booking / group row
const SECTION_H = 44;   // px — section header row
const HEADER_H  = 52;   // px — timeline header (month + optional tick)
const LEFT_W    = 248;  // px — fixed left column width

function ResourceGantt({
  bookings,
  resources,
  localProjects,
  taktRequests,
  viewMode,
}: {
  bookings: NuResourceBooking[];
  resources: Resource[];
  localProjects: NuLocalProject[];
  taktRequests: unknown[];
  viewMode: ViewMode;
}) {
  // ── Expansion state ──────────────────────────────────────────────────────
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["external", "internal", "general"]),
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedBooking, setSelectedBooking] = useState<EnrichedBooking | null>(null);

  const toggleSection = (id: string) =>
    setExpandedSections((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleGroup = (id: string) =>
    setExpandedGroups((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Lookup maps ──────────────────────────────────────────────────────────
  const resourceMap = useMemo(
    () => new Map(resources.map((r) => [r.id, r.name])),
    [resources],
  );
  const localProjectMap = useMemo(
    () => new Map(localProjects.map((p) => [p.id, p.displayName])),
    [localProjects],
  );
  const taktRequestProjectMap = useMemo(() => {
    const m = new Map<string, string>();
    taktRequests.forEach((req: any) => {
      if (req?.id && req?.projectName) m.set(req.id as string, req.projectName as string);
    });
    return m;
  }, [taktRequests]);

  // ── Build sections ───────────────────────────────────────────────────────
  const sections = useMemo((): GanttSection[] => {
    const externalMap = new Map<string, EnrichedBooking[]>();
    const internalMap = new Map<string, EnrichedBooking[]>();
    const generalMap  = new Map<string, EnrichedBooking[]>();

    bookings.forEach((b) => {
      const resourceName = (b.resourceId ? resourceMap.get(b.resourceId) : null) ?? "–";

      if (b.sourceType === "TAKT_REQUEST") {
        const projName = taktRequestProjectMap.get(b.sourceReferenceId ?? "") ?? b.sourceReferenceId ?? "Unbekanntes Projekt";
        const arr = externalMap.get(projName) ?? [];
        arr.push({ ...b, resourceName, sectionId: "external", groupName: projName });
        externalMap.set(projName, arr);
      } else if (b.sourceType === "LOCAL_PROJECT") {
        const projName = b.localProjectId
          ? (localProjectMap.get(b.localProjectId) ?? b.localProjectId)
          : "Kein Projekt";
        const arr = internalMap.get(projName) ?? [];
        arr.push({ ...b, resourceName, sectionId: "internal", groupName: projName });
        internalMap.set(projName, arr);
      } else {
        const key = resourceName;
        const arr = generalMap.get(key) ?? [];
        arr.push({ ...b, resourceName, sectionId: "general", groupName: key });
        generalMap.set(key, arr);
      }
    });

    const toGroups = (m: Map<string, EnrichedBooking[]>): GanttGroup[] =>
      Array.from(m.entries()).map(([name, bks]) => ({ id: name, name, bookings: bks }));

    const all: GanttSection[] = [
      {
        id: "external", label: "Externe Projekte", Icon: Building2,
        accentColor: "#8b5cf6", bgColor: "rgba(139,92,246,0.06)",
        groups: toGroups(externalMap),
      },
      {
        id: "internal", label: "Interne Projekte", Icon: FolderOpen,
        accentColor: "#3b82f6", bgColor: "rgba(59,130,246,0.06)",
        groups: toGroups(internalMap),
      },
      {
        id: "general", label: "Allgemeine Belegungen", Icon: Layers,
        accentColor: "#6b7280", bgColor: "rgba(107,114,128,0.06)",
        groups: toGroups(generalMap),
      },
    ];

    return all.filter((s) => s.groups.length > 0);
  }, [bookings, resourceMap, localProjectMap, taktRequestProjectMap]);

  // Initialise all groups as expanded once sections load
  useEffect(() => {
    const ids = new Set<string>();
    sections.forEach((s) => s.groups.forEach((g) => ids.add(`${s.id}::${g.id}`)));
    setExpandedGroups(ids);
  }, [sections]);

  // ── Flat visible rows ────────────────────────────────────────────────────
  const rows = useMemo((): GanttRow[] => {
    const out: GanttRow[] = [];
    sections.forEach((section) => {
      out.push({ kind: "section", section });
      if (!expandedSections.has(section.id)) return;
      section.groups.forEach((group) => {
        out.push({ kind: "group", section, group });
        const key = `${section.id}::${group.id}`;
        if (!expandedGroups.has(key)) return;
        group.bookings.forEach((booking) =>
          out.push({ kind: "booking", section, group, booking }),
        );
      });
    });
    return out;
  }, [sections, expandedSections, expandedGroups]);

  // ── Date range ───────────────────────────────────────────────────────────
  const { rangeStart, rangeEnd, totalDays, pxPerDay } = useMemo(() => {
    const px = getPxPerDay(viewMode);
    if (!bookings.length) {
      const now = new Date();
      return { rangeStart: now, rangeEnd: addDays(now, 30), totalDays: 30, pxPerDay: px };
    }
    const starts = bookings.map((b) => new Date(b.startAt).getTime());
    const ends   = bookings.map((b) => new Date(b.endAt).getTime());
    const minMs  = Math.min(...starts);
    const maxMs  = Math.max(...ends);
    const rStart = addDays(new Date(minMs), -7);
    rStart.setHours(0, 0, 0, 0);
    const rEnd = addDays(new Date(maxMs), 7);
    rEnd.setHours(23, 59, 59, 999);
    return {
      rangeStart: rStart,
      rangeEnd: rEnd,
      totalDays: differenceInCalendarDays(rEnd, rStart) + 1,
      pxPerDay: px,
    };
  }, [bookings, viewMode]);

  const totalWidth = totalDays * pxPerDay;
  const monthSegs  = useMemo(() => buildMonthSegments(rangeStart, rangeEnd, pxPerDay), [rangeStart, rangeEnd, pxPerDay]);
  const ticks      = useMemo(() => buildTicks(rangeStart, rangeEnd, pxPerDay, viewMode), [rangeStart, rangeEnd, pxPerDay, viewMode]);
  const showTicks  = viewMode !== ViewMode.Month;

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Bar geometry ─────────────────────────────────────────────────────────
  const barGeom = useCallback(
    (startAt: string, endAt: string) => {
      const s = new Date(startAt).getTime();
      const e = new Date(endAt).getTime();
      const left  = Math.max(0, (s - rangeStart.getTime()) / MS_PER_DAY * pxPerDay);
      const width = Math.max(6, (e - s) / MS_PER_DAY * pxPerDay);
      return { left, width };
    },
    [rangeStart, pxPerDay],
  );

  if (!bookings.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <CalendarDays className="w-12 h-12 text-muted-foreground opacity-30" />
        <p className="text-muted-foreground text-sm">Keine Ressourcenbelegungen gefunden.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden" style={{ maxHeight: "calc(100vh - 300px)", minHeight: 320 }}>
      {/* Scrollable body */}
      <div ref={scrollRef} className="overflow-auto flex-1" style={{ position: "relative" }}>
        {/* ── Timeline header (sticky top) ─────────────────────────────────── */}
        <div
          style={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            display: "flex",
            height: HEADER_H,
            background: "hsl(var(--card))",
            borderBottom: "1px solid hsl(var(--border))",
            minWidth: LEFT_W + totalWidth,
          }}
        >
          {/* Corner cell */}
          <div
            style={{
              position: "sticky",
              left: 0,
              width: LEFT_W,
              flexShrink: 0,
              zIndex: 30,
              background: "hsl(var(--card))",
              borderRight: "1px solid hsl(var(--border))",
            }}
          />
          {/* Month + tick rows */}
          <div style={{ position: "relative", width: totalWidth, flexShrink: 0 }}>
            {/* Month names */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: showTicks ? 26 : HEADER_H, overflow: "hidden" }}>
              {monthSegs.map((seg, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: seg.left,
                    width: seg.width,
                    height: "100%",
                    borderRight: "1px solid hsl(var(--border))",
                    paddingLeft: 6,
                    display: "flex",
                    alignItems: "center",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "hsl(var(--muted-foreground))",
                    textTransform: "capitalize",
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                  }}
                >
                  {seg.width > 40 ? seg.label : ""}
                </div>
              ))}
            </div>
            {/* Day/week ticks */}
            {showTicks && (
              <div style={{ position: "absolute", top: 26, left: 0, right: 0, height: HEADER_H - 26, overflow: "hidden" }}>
                {ticks.map((tick, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      left: tick.left,
                      height: "100%",
                      paddingLeft: 4,
                      display: "flex",
                      alignItems: "center",
                      fontSize: 10,
                      color: "hsl(var(--muted-foreground))",
                      borderLeft: "1px solid hsl(var(--border))",
                    }}
                  >
                    {tick.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Rows ─────────────────────────────────────────────────────────── */}
        <div style={{ minWidth: LEFT_W + totalWidth }}>
          {rows.map((row, idx) => {
            const rowH = row.kind === "section" ? SECTION_H : ROW_H;

            return (
              <div
                key={idx}
                style={{
                  display: "flex",
                  height: rowH,
                  borderBottom: "1px solid hsl(var(--border))",
                  position: "relative",
                }}
              >
                {/* Left label (sticky) */}
                <div
                  style={{
                    position: "sticky",
                    left: 0,
                    width: LEFT_W,
                    flexShrink: 0,
                    zIndex: 10,
                    background:
                      row.kind === "section"
                        ? row.section.bgColor
                        : "hsl(var(--card))",
                    borderRight: "1px solid hsl(var(--border))",
                    display: "flex",
                    alignItems: "center",
                    paddingRight: 8,
                    ...(row.kind === "section"
                      ? { borderLeft: `3px solid ${row.section.accentColor}`, paddingLeft: 10 }
                      : row.kind === "group"
                      ? { paddingLeft: 24 }
                      : { paddingLeft: 40 }),
                  }}
                  onClick={
                    row.kind === "section"
                      ? () => toggleSection(row.section.id)
                      : row.kind === "group"
                      ? () => toggleGroup(`${row.section.id}::${row.group.id}`)
                      : undefined
                  }
                  className={row.kind !== "booking" ? "cursor-pointer hover:brightness-95 transition-all select-none" : ""}
                >
                  {row.kind === "section" && (
                    <>
                      <row.section.Icon
                        className="w-4 h-4 shrink-0 mr-2"
                        style={{ color: row.section.accentColor }}
                      />
                      <span className="text-xs font-semibold truncate flex-1" style={{ color: row.section.accentColor }}>
                        {row.section.label}
                      </span>
                      <span className="text-xs text-muted-foreground mr-1">
                        {row.section.groups.reduce((s, g) => s + g.bookings.length, 0)}
                      </span>
                      {expandedSections.has(row.section.id)
                        ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      }
                    </>
                  )}
                  {row.kind === "group" && (
                    <>
                      {expandedGroups.has(`${row.section.id}::${row.group.id}`)
                        ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 mr-1.5" />
                        : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 mr-1.5" />
                      }
                      <span className="text-xs font-medium truncate flex-1">{row.group.name}</span>
                      <span className="text-xs text-muted-foreground ml-1 shrink-0">{row.group.bookings.length}</span>
                    </>
                  )}
                  {row.kind === "booking" && (
                    <span className="text-xs text-muted-foreground truncate">
                      {row.booking.resourceName}
                    </span>
                  )}
                </div>

                {/* Right timeline area */}
                <div style={{ position: "relative", width: totalWidth, flexShrink: 0 }}>
                  {/* Today line */}
                  {(() => {
                    const today = new Date();
                    const left = differenceInCalendarDays(today, rangeStart) * pxPerDay;
                    if (left < 0 || left > totalWidth) return null;
                    return (
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left,
                          width: 1,
                          background: "rgba(239,68,68,0.35)",
                          zIndex: 1,
                          pointerEvents: "none",
                        }}
                      />
                    );
                  })()}

                  {/* Section / group background span */}
                  {(row.kind === "section" || row.kind === "group") && (() => {
                    // Compute spanning bar over all bookings in this section/group
                    const bks =
                      row.kind === "section"
                        ? row.section.groups.flatMap((g) => g.bookings)
                        : row.group.bookings;
                    if (!bks.length) return null;
                    const minS = Math.min(...bks.map((b) => new Date(b.startAt).getTime()));
                    const maxE = Math.max(...bks.map((b) => new Date(b.endAt).getTime()));
                    const { left, width } = barGeom(new Date(minS).toISOString(), new Date(maxE).toISOString());
                    return (
                      <div
                        style={{
                          position: "absolute",
                          top: "50%",
                          transform: "translateY(-50%)",
                          left,
                          width,
                          height: row.kind === "section" ? 10 : 8,
                          borderRadius: 4,
                          background: row.section.accentColor,
                          opacity: row.kind === "section" ? 0.18 : 0.12,
                          pointerEvents: "none",
                        }}
                      />
                    );
                  })()}

                  {/* Booking bar */}
                  {row.kind === "booking" && (() => {
                    const b   = row.booking;
                    const { left, width } = barGeom(b.startAt, b.endAt);
                    const color = BOOKING_STATUS_COLOR[b.status] ?? "#6b7280";
                    const aDay  = isAllDay(b.startAt, b.endAt);
                    const isSelected = selectedBooking?.id === b.id;
                    return (
                      <div
                        onClick={() => setSelectedBooking(isSelected ? null : b)}
                        title={`${b.resourceName} · ${SOURCE_TYPE_LABEL[b.sourceType] ?? b.sourceType} · ${BOOKING_STATUS_LABEL[b.status]}`}
                        style={{
                          position: "absolute",
                          top: "50%",
                          transform: "translateY(-50%)",
                          left,
                          width,
                          height: 22,
                          borderRadius: 4,
                          background: color,
                          opacity: b.status === "CANCELLED" ? 0.35 : 0.88,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          paddingLeft: 5,
                          overflow: "hidden",
                          fontSize: 10,
                          color: "#fff",
                          fontWeight: 500,
                          outline: isSelected ? "2px solid hsl(var(--foreground))" : undefined,
                          outlineOffset: 1,
                          zIndex: 2,
                          boxShadow: isSelected ? "0 0 0 2px hsl(var(--background))" : undefined,
                          transition: "opacity 0.1s",
                        }}
                      >
                        {width > 30 ? (aDay ? "Ganztägig" : SOURCE_TYPE_LABEL[b.sourceType] ?? b.sourceType) : ""}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail panel (slides in below chart) */}
      {selectedBooking && (
        <BookingDetail
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Takttermine Gantt helpers (unchanged from before)
// ─────────────────────────────────────────────────────────────────────────────

function buildTaktTermineTasks(taktRequests: any[]): Task[] {
  if (!taktRequests?.length) return [];
  const projectMap = new Map<string, { name: string; start: Date; end: Date }>();
  taktRequests.forEach((req: any) => {
    const projId   = req.projectId   ?? "unknown";
    const projName = req.projectName ?? "Unbekanntes Projekt";
    const startStr = req.plannedStart ?? req.sentAt ?? req.createdAt;
    const endStr   = req.plannedEnd   ?? req.responseRequiredBy ?? req.expiresAt ?? req.updatedAt;
    const start    = new Date(startStr);
    const end      = safeEnd(start, new Date(endStr));
    const ex = projectMap.get(projId);
    if (!ex) { projectMap.set(projId, { name: projName, start, end }); }
    else { if (start < ex.start) ex.start = start; if (end > ex.end) ex.end = end; }
  });
  const tasks: Task[] = [];
  projectMap.forEach((proj, projId) => {
    tasks.push({
      id: `proj_${projId}`, name: proj.name, type: "project",
      start: proj.start, end: safeEnd(proj.start, proj.end),
      progress: 100, hideChildren: false,
      styles: { backgroundColor: "transparent", progressColor: "transparent", backgroundSelectedColor: "transparent" },
    });
  });
  taktRequests.forEach((req: any) => {
    const projId   = req.projectId ?? "unknown";
    const startStr = req.plannedStart ?? req.sentAt ?? req.createdAt;
    const endStr   = req.plannedEnd   ?? req.responseRequiredBy ?? req.expiresAt ?? req.updatedAt;
    const start    = new Date(startStr);
    const end      = safeEnd(start, new Date(endStr));
    const color    = STATUS_COLOR[req.status] ?? "#6b7280";
    const zone     = req.zone   as string | null;
    const gewerk   = req.gewerk as string | null;
    const sub      = [zone, gewerk].filter(Boolean).join(" · ");
    const label    = req.taktBezeichnung
      ? (sub ? `${req.taktBezeichnung} – ${sub}` : req.taktBezeichnung)
      : (sub || req.requestNumber || "Takt");
    tasks.push({
      id: req.id, name: label, type: "task", start, end, progress: 100,
      project: `proj_${projId}`,
      styles: { backgroundColor: color, progressColor: color, backgroundSelectedColor: color },
    });
  });
  return tasks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function TerminuebersichtPage() {
  const { t } = useTranslation();
  const [tab, setTab]           = useState<"takttermine" | "belegungen">("takttermine");
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Month);

  const { data: taktRequests, isLoading: loadingTR } = useListTaktRequests(
    { role: "nu" } as any,
    { query: { queryKey: getListTaktRequestsQueryKey({ role: "nu" } as any), refetchInterval: 30_000, refetchIntervalInBackground: false } },
  );

  const { data: bookingsResult, isLoading: loadingBk } = useListNuResourceBookings({ limit: 200 });
  const { data: localProjectsResult } = useListNuLocalProjects({ limit: 200 });
  const { data: resources } = useListResources();

  const taktTermineTasks = useMemo(() => buildTaktTermineTasks((taktRequests ?? []) as any[]), [taktRequests]);
  const bookings  = bookingsResult?.items ?? [];
  const localProjects: NuLocalProject[] = localProjectsResult?.items ?? [];
  const resourceList: Resource[] = resources ?? [];

  const isLoading = tab === "takttermine" ? loadingTR : loadingBk;

  const colWidth = viewMode === ViewMode.Day ? 60 : viewMode === ViewMode.Week ? 200 : 300;

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{t("gantt.title")}</h1>

          {/* Tab switcher */}
          <div className="flex gap-1 bg-sidebar-accent p-1 rounded text-sm">
            {(["takttermine", "belegungen"] as const).map((t2) => (
              <button
                key={t2}
                onClick={() => setTab(t2)}
                className={`px-3 py-1 rounded transition-colors ${
                  tab === t2 ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t2 === "takttermine" ? "Takttermine" : "Ressourcenbelegung"}
              </button>
            ))}
          </div>
        </div>

        {/* View mode */}
        <div className="flex gap-1 bg-sidebar-accent p-1 rounded text-sm">
          {([ViewMode.Day, ViewMode.Week, ViewMode.Month] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded transition-colors ${
                viewMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {mode === ViewMode.Day ? "Tag" : mode === ViewMode.Week ? "Woche" : "Monat"}
            </button>
          ))}
        </div>
      </div>

      {/* Status legend (takttermine only) */}
      {tab === "takttermine" && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {Object.entries(STATUS_COLOR).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              {STATUS_LABEL[status]}
            </span>
          ))}
        </div>
      )}

      {/* Booking status legend (belegungen only) */}
      {tab === "belegungen" && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {Object.entries(BOOKING_STATUS_COLOR).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: color }} />
              {BOOKING_STATUS_LABEL[status] ?? status}
            </span>
          ))}
          <span className="text-muted-foreground opacity-60 ml-1">— Klick auf Balken für Details</span>
        </div>
      )}

      {/* Chart */}
      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : tab === "takttermine" ? (
            taktTermineTasks.length > 0 ? (
              <div className="gantt-container overflow-x-auto" style={{ minWidth: 800 }}>
                <Gantt
                  tasks={taktTermineTasks}
                  viewMode={viewMode}
                  locale="de"
                  columnWidth={colWidth}
                  listCellWidth="220px"
                  rowHeight={40}
                  barFill={70}
                  barCornerRadius={4}
                />
              </div>
            ) : (
              <div className="p-8 text-center text-muted-foreground">Keine Takttermine gefunden.</div>
            )
          ) : (
            <ResourceGantt
              bookings={bookings}
              resources={resourceList}
              localProjects={localProjects}
              taktRequests={(taktRequests ?? []) as unknown[]}
              viewMode={viewMode}
            />
          )}
        </CardContent>
      </Card>

      {/* Dark-mode overrides */}
      <style dangerouslySetInnerHTML={{ __html: `
        .gantt-container .gantt ._3w-y_ { fill: hsl(var(--card)); }
        .gantt-container .gantt ._2P-5r, .gantt-container .gantt ._1X-d_ { stroke: hsl(var(--border)); }
        .gantt-container .gantt ._2v0Xf { fill: hsl(var(--foreground)); }
        .gantt-container .gantt ._1bV_q { fill: hsl(var(--muted)); }
        .gantt-container .gantt ._3T-i_ { fill: hsl(var(--muted)); }
      `}} />
    </div>
  );
}
