/**
 * Terminübersicht — Ressourcen-Gantt
 *
 * Left column  : Ressourcen, gruppiert nach Ressourcentyp
 * Timeline     : Belegungen pro Ressource
 *                  TAKT_REQUEST  → Externe Projekte  (violet)
 *                  LOCAL_PROJECT → Interne Projekte   (blue)
 *                  Sonstige      → Sonstige Belegungen (slate/amber/orange)
 * Red bands    : Zeitbereiche, in denen sich Belegungen derselben Ressource
 *                überschneiden
 * Filter       : Ressourcentyp + Belegungsart
 */
import { useState, useMemo, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  format,
  differenceInCalendarDays,
  addDays,
  startOfMonth,
  endOfMonth,
} from "date-fns";
import { de } from "date-fns/locale";
import {
  useListNuResourceBookings,
  useListNuLocalProjects,
  useListResources,
  useListTaktRequests,
  getListTaktRequestsQueryKey,
  type NuResourceBooking,
  type NuLocalProject,
} from "@workspace/api-client-react";
import {
  useListResourceTypes,
  type ResourceTypeRecord,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Loader2,
  X,
  CalendarDays,
  ChevronRight,
  ChevronDown,
  Filter,
} from "lucide-react";
import { computeUtilizationBands } from "@/lib/gantt-util-bands";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SOURCE_COLOR: Record<string, string> = {
  TAKT_REQUEST:  "#8b5cf6",
  LOCAL_PROJECT: "#3b82f6",
  MANUAL_BLOCK:  "#64748b",
  ABSENCE:       "#f59e0b",
  MAINTENANCE:   "#f97316",
};

const SOURCE_LABEL: Record<string, string> = {
  TAKT_REQUEST:  "Externer Auftrag",
  LOCAL_PROJECT: "Internes Projekt",
  MANUAL_BLOCK:  "Manuelle Blockierung",
  ABSENCE:       "Abwesenheit",
  MAINTENANCE:   "Wartung",
};

const BOOKING_STATUS_LABEL: Record<string, string> = {
  TENTATIVE: "Vorläufig",
  CONFIRMED:  "Bestätigt",
  CANCELLED:  "Storniert",
};

const CATEGORY_LABEL: Record<string, string> = {
  PERSONNEL: "Personal",
  CREW:      "Kolonne",
  EQUIPMENT: "Ausrüstung",
  MACHINE:   "Maschine",
  OTHER:     "Sonstige",
};

/** Three filter buckets for Belegungsart */
const SOURCE_FILTER_OPTIONS = [
  { id: "TAKT_REQUEST",  label: "Externe Projekte",    color: SOURCE_COLOR.TAKT_REQUEST },
  { id: "LOCAL_PROJECT", label: "Interne Projekte",    color: SOURCE_COLOR.LOCAL_PROJECT },
  { id: "OTHER",         label: "Sonstige Belegungen", color: SOURCE_COLOR.MANUAL_BLOCK },
] as const;

type SourceGroup = (typeof SOURCE_FILTER_OPTIONS)[number]["id"];

function getSourceGroup(sourceType: string): SourceGroup {
  if (sourceType === "TAKT_REQUEST")  return "TAKT_REQUEST";
  if (sourceType === "LOCAL_PROJECT") return "LOCAL_PROJECT";
  return "OTHER";
}

// ─────────────────────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────────────────────

interface ResourceRow {
  id: string;
  name: string;
  bookings: NuResourceBooking[];
  typeLevel?: boolean;
}

interface ResourceSection {
  id: string;
  name: string;
  resources: ResourceRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(s?: string | null) {
  if (!s) return "–";
  try { return format(new Date(s), "dd.MM.yyyy", { locale: de }); } catch { return String(s); }
}
function fmtDt(s?: string | null) {
  if (!s) return "–";
  try { return format(new Date(s), "dd.MM.yyyy HH:mm", { locale: de }); } catch { return String(s); }
}
function isAllDay(startAt: string, endAt: string): boolean {
  try {
    const s = new Date(startAt);
    const e = new Date(endAt);
    return (
      s.getHours() === 0 && s.getMinutes() === 0 && s.getSeconds() === 0 &&
      e.getHours() === 23 && e.getMinutes() === 59
    );
  } catch { return false; }
}

/**
 * Compute all overlap intervals from a list of {start, end} (ms timestamps),
 * merge them and return the merged list.
 */
function computeOverlapBands(intervals: { start: number; end: number }[]) {
  const raw: { start: number; end: number }[] = [];
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      const s = Math.max(intervals[i].start, intervals[j].start);
      const e = Math.min(intervals[i].end,   intervals[j].end);
      if (s < e) raw.push({ start: s, end: e });
    }
  }
  raw.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const iv of raw) {
    if (merged.length && iv.start < merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged;
}

const MS_PER_DAY = 86_400_000;

function getPxPerDay(mode: "day" | "week" | "month"): number {
  if (mode === "day")  return 48;
  if (mode === "week") return 20;
  return 5;
}

function buildMonthSegments(start: Date, end: Date, pxPerDay: number) {
  const segs: { left: number; width: number; label: string }[] = [];
  let cur = startOfMonth(start);
  while (cur < end) {
    const mEnd  = endOfMonth(cur);
    const clampS = cur < start ? start : cur;
    const clampE = mEnd > end  ? end   : mEnd;
    const left  = differenceInCalendarDays(clampS, start) * pxPerDay;
    const width = (differenceInCalendarDays(clampE, clampS) + 1) * pxPerDay;
    segs.push({ left, width, label: format(cur, "MMMM yyyy", { locale: de }) });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return segs;
}

function buildTicks(start: Date, end: Date, pxPerDay: number, mode: "day" | "week" | "month") {
  const ticks: { left: number; label: string }[] = [];
  if (mode === "day") {
    let d = new Date(start); d.setHours(0, 0, 0, 0);
    while (d <= end) {
      ticks.push({ left: differenceInCalendarDays(d, start) * pxPerDay, label: String(d.getDate()) });
      d = addDays(d, 1);
    }
  } else if (mode === "week") {
    let d = new Date(start);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    d.setHours(0, 0, 0, 0);
    while (d <= end) {
      const left = differenceInCalendarDays(d, start) * pxPerDay;
      if (left >= 0) ticks.push({ left, label: format(d, "d. MMM", { locale: de }) });
      d = addDays(d, 7);
    }
  }
  return ticks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout constants
// ─────────────────────────────────────────────────────────────────────────────

const ROW_H     = 34;
const SECTION_H = 40;
const HEADER_H  = 52;
const LEFT_W    = 244;

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────────────────────

function BookingDetailPanel({
  booking,
  resourceName,
  projectLabel,
  onClose,
}: {
  booking: NuResourceBooking;
  resourceName: string;
  projectLabel: string;
  onClose: () => void;
}) {
  const allDay = isAllDay(booking.startAt, booking.endAt);
  const color  = SOURCE_COLOR[booking.sourceType] ?? "#6b7280";
  return (
    <div className="border-t border-border bg-card px-5 py-4 animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-sm font-semibold">{resourceName}</div>
          <div className="text-xs font-medium" style={{ color }}>
            {SOURCE_LABEL[booking.sourceType] ?? booking.sourceType}
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
            {allDay ? (
              <>
                {fmtDate(booking.startAt)}{" "}
                <span className="text-xs bg-muted px-1 rounded">Ganztägig</span>
              </>
            ) : (
              <>
                {fmtDt(booking.startAt)}
                <br />
                <span className="text-muted-foreground">bis </span>
                {fmtDt(booking.endAt)}
              </>
            )}
          </div>
        </div>
        {projectLabel && (
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Projekt</div>
            <div className="font-medium">{projectLabel}</div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">Status</div>
          <div className="font-medium">
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
          <div className="sm:col-span-2">
            <div className="text-xs text-muted-foreground mb-0.5">Notiz</div>
            <div className="text-sm">{booking.note}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Resource Gantt component
// ─────────────────────────────────────────────────────────────────────────────

type FlatRow =
  | { kind: "section"; section: ResourceSection }
  | { kind: "resource"; section: ResourceSection; resource: ResourceRow };

export function ResourceGantt({
  sections,
  allDates,
  viewMode,
  localProjectMap,
  taktProjectMap,
}: {
  sections: ResourceSection[];
  allDates: { start: string; end: string }[];
  viewMode: "day" | "week" | "month";
  localProjectMap: Map<string, string>;
  taktProjectMap: Map<string, string>;
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(sections.map((s) => s.id)),
  );
  const [selectedBooking, setSelectedBooking] = useState<{
    booking: NuResourceBooking;
    resourceName: string;
  } | null>(null);

  useEffect(() => {
    setExpandedSections(new Set(sections.map((s) => s.id)));
  }, [sections]);

  const toggleSection = (id: string) =>
    setExpandedSections((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  // ── Date range ─────────────────────────────────────────────────────────────
  const { rangeStart, rangeEnd, totalDays, pxPerDay } = useMemo(() => {
    const px = getPxPerDay(viewMode);
    if (!allDates.length) {
      const now = new Date();
      return { rangeStart: now, rangeEnd: addDays(now, 30), totalDays: 30, pxPerDay: px };
    }
    const starts = allDates.map((d) => new Date(d.start).getTime());
    const ends   = allDates.map((d) => new Date(d.end).getTime());
    const rStart = addDays(new Date(Math.min(...starts)), -7);
    rStart.setHours(0, 0, 0, 0);
    const rEnd = addDays(new Date(Math.max(...ends)), 7);
    rEnd.setHours(23, 59, 59, 999);
    return {
      rangeStart: rStart,
      rangeEnd:   rEnd,
      totalDays:  differenceInCalendarDays(rEnd, rStart) + 1,
      pxPerDay:   px,
    };
  }, [allDates, viewMode]);

  const totalWidth = totalDays * pxPerDay;
  const monthSegs  = useMemo(
    () => buildMonthSegments(rangeStart, rangeEnd, pxPerDay),
    [rangeStart, rangeEnd, pxPerDay],
  );
  const ticks     = useMemo(
    () => buildTicks(rangeStart, rangeEnd, pxPerDay, viewMode),
    [rangeStart, rangeEnd, pxPerDay, viewMode],
  );
  const showTicks = viewMode !== "month";

  const barGeom = useCallback(
    (startAt: string, endAt: string) => {
      const s    = new Date(startAt).getTime();
      const e    = new Date(endAt).getTime();
      const left  = Math.max(0, (s - rangeStart.getTime()) / MS_PER_DAY * pxPerDay);
      const width = Math.max(6, (e - s) / MS_PER_DAY * pxPerDay);
      return { left, width };
    },
    [rangeStart, pxPerDay],
  );

  const getProjectLabel = useCallback(
    (b: NuResourceBooking) => {
      if (b.sourceType === "LOCAL_PROJECT" && b.localProjectId)
        return localProjectMap.get(b.localProjectId) ?? "";
      if (b.sourceType === "TAKT_REQUEST" && b.sourceReferenceId)
        return taktProjectMap.get(b.sourceReferenceId) ?? "";
      return "";
    },
    [localProjectMap, taktProjectMap],
  );

  // ── Flat rows ──────────────────────────────────────────────────────────────
  const rows = useMemo((): FlatRow[] => {
    const out: FlatRow[] = [];
    sections.forEach((section) => {
      out.push({ kind: "section", section });
      if (!expandedSections.has(section.id)) return;
      section.resources.forEach((resource) =>
        out.push({ kind: "resource", section, resource }),
      );
    });
    return out;
  }, [sections, expandedSections]);

  const scrollRef = useRef<HTMLDivElement>(null);

  if (!sections.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <CalendarDays className="w-12 h-12 text-muted-foreground opacity-30" />
        <p className="text-muted-foreground text-sm">Keine Belegungen gefunden.</p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col overflow-hidden"
      style={{ maxHeight: "calc(100vh - 300px)", minHeight: 320 }}
    >
      <div ref={scrollRef} className="overflow-auto flex-1" style={{ position: "relative" }}>

        {/* ── Sticky timeline header ──────────────────────────────────────── */}
        <div
          style={{
            position: "sticky", top: 0, zIndex: 20, display: "flex",
            height: HEADER_H, background: "hsl(var(--card))",
            borderBottom: "1px solid hsl(var(--border))",
            minWidth: LEFT_W + totalWidth,
          }}
        >
          {/* Corner cell */}
          <div
            style={{
              position: "sticky", left: 0, width: LEFT_W, flexShrink: 0, zIndex: 30,
              background: "hsl(var(--card))",
              borderRight: "1px solid hsl(var(--border))",
              display: "flex", alignItems: "center", paddingLeft: 12,
            }}
          >
            <span className="text-xs text-muted-foreground font-medium">Ressource</span>
          </div>

          {/* Month + tick bands */}
          <div style={{ position: "relative", width: totalWidth, flexShrink: 0 }}>
            <div
              style={{
                position: "absolute", top: 0, left: 0, right: 0,
                height: showTicks ? 26 : HEADER_H, overflow: "hidden",
              }}
            >
              {monthSegs.map((seg, i) => (
                <div
                  key={i}
                  style={{
                    position: "absolute", left: seg.left, width: seg.width, height: "100%",
                    borderRight: "1px solid hsl(var(--border))", paddingLeft: 6,
                    display: "flex", alignItems: "center", fontSize: 11, fontWeight: 600,
                    color: "hsl(var(--muted-foreground))", textTransform: "capitalize",
                    overflow: "hidden", whiteSpace: "nowrap",
                  }}
                >
                  {seg.width > 40 ? seg.label : ""}
                </div>
              ))}
            </div>

            {showTicks && (
              <div
                style={{
                  position: "absolute", top: 26, left: 0, right: 0,
                  height: HEADER_H - 26, overflow: "hidden",
                }}
              >
                {ticks.map((tick, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute", left: tick.left, height: "100%", paddingLeft: 4,
                      display: "flex", alignItems: "center", fontSize: 10,
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

        {/* ── Rows ────────────────────────────────────────────────────────── */}
        <div style={{ minWidth: LEFT_W + totalWidth }}>
          {rows.map((row, idx) => {
            const rowH = row.kind === "section" ? SECTION_H : ROW_H;

            return (
              <div
                key={idx}
                style={{
                  display: "flex", height: rowH,
                  borderBottom: "1px solid hsl(var(--border))",
                  position: "relative",
                }}
              >
                {/* ── Left label (sticky) ─────────────────────────────────── */}
                <div
                  style={{
                    position: "sticky", left: 0, width: LEFT_W, flexShrink: 0, zIndex: 10,
                    background: row.kind === "section"
                      ? "hsl(var(--sidebar-accent))"
                      : "hsl(var(--card))",
                    borderRight: "1px solid hsl(var(--border))",
                    display: "flex", alignItems: "center",
                    paddingLeft:  row.kind === "section" ? 10 : 24,
                    paddingRight: 8,
                    ...(row.kind === "section"
                      ? { borderLeft: "3px solid #6366f1" }
                      : {}),
                  }}
                  onClick={
                    row.kind === "section"
                      ? () => toggleSection(row.section.id)
                      : undefined
                  }
                  className={
                    row.kind === "section"
                      ? "cursor-pointer hover:brightness-95 transition-all select-none"
                      : ""
                  }
                >
                  {row.kind === "section" && (
                    <>
                      {expandedSections.has(row.section.id) ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 mr-1.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 mr-1.5" />
                      )}
                      <span className="text-xs font-semibold truncate flex-1 text-foreground">
                        {row.section.name}
                      </span>
                      <span className="text-xs text-muted-foreground mr-1 shrink-0">
                        {row.section.resources.length}
                      </span>
                    </>
                  )}
                  {row.kind === "resource" && (
                    <span className="text-xs truncate text-foreground/80 leading-tight">
                      {row.resource.name}
                    </span>
                  )}
                </div>

                {/* ── Timeline area ───────────────────────────────────────── */}
                <div style={{ position: "relative", width: totalWidth, flexShrink: 0 }}>

                  {/* Today line */}
                  {(() => {
                    const left = differenceInCalendarDays(new Date(), rangeStart) * pxPerDay;
                    if (left < 0 || left > totalWidth) return null;
                    return (
                      <div
                        style={{
                          position: "absolute", top: 0, bottom: 0, left, width: 1,
                          background: "rgba(239,68,68,0.35)", zIndex: 1,
                          pointerEvents: "none",
                        }}
                      />
                    );
                  })()}

                  {/* Section span bar */}
                  {row.kind === "section" && (() => {
                    const allB = row.section.resources.flatMap((r) => r.bookings);
                    if (!allB.length) return null;
                    const minS = Math.min(...allB.map((b) => new Date(b.startAt).getTime()));
                    const maxE = Math.max(...allB.map((b) => new Date(b.endAt).getTime()));
                    const { left, width } = barGeom(
                      new Date(minS).toISOString(),
                      new Date(maxE).toISOString(),
                    );
                    return (
                      <div
                        style={{
                          position: "absolute", top: "50%",
                          transform: "translateY(-50%)",
                          left, width, height: 8, borderRadius: 4,
                          background: "#6366f1", opacity: 0.15,
                          pointerEvents: "none",
                        }}
                      />
                    );
                  })()}

                  {/* Resource row — conflict bands + booking bars */}
                  {row.kind === "resource" && (() => {
                    const { bookings } = row.resource;
                    if (!bookings.length) return null;

                    const utilizationBands = computeUtilizationBands(
                      bookings,
                      rangeStart,
                      rangeEnd,
                    );

                    return (
                      <>
                        {/* Red conflict bands */}
                        {utilizationBands.filter((band) => band.kind === "conflict").map((band, bi) => {
                          const { left, width } = barGeom(
                            new Date(band.start).toISOString(),
                            new Date(band.end).toISOString(),
                          );
                          return (
                            <div
                              key={`conflict-${bi}`}
                              style={{
                                position: "absolute", top: 0, bottom: 0,
                                left, width: Math.max(width, 3),
                                background: "rgba(239,68,68,0.15)",
                                borderLeft:  "2px solid rgba(239,68,68,0.55)",
                                borderRight: "2px solid rgba(239,68,68,0.55)",
                                pointerEvents: "none", zIndex: 1,
                              }}
                            />
                          );
                        })}

                        {/* Booking bars */}
                        {bookings.map((b) => {
                          const isSelected = selectedBooking?.booking.id === b.id;
                          const color   = SOURCE_COLOR[b.sourceType] ?? "#6b7280";
                          const dimmed  = b.status === "CANCELLED";
                          const tentative = b.status === "TENTATIVE";
                          const { left, width } = barGeom(b.startAt, b.endAt);
                          const projectLabel = getProjectLabel(b);
                          const barLabel =
                            width > 50
                              ? (projectLabel || SOURCE_LABEL[b.sourceType] || "")
                              : "";

                          return (
                            <div
                              key={b.id}
                              onClick={() =>
                                setSelectedBooking(
                                  isSelected
                                    ? null
                                    : { booking: b, resourceName: row.resource.name },
                                )
                              }
                              title={`${SOURCE_LABEL[b.sourceType] ?? b.sourceType}${projectLabel ? ` — ${projectLabel}` : ""}`}
                              style={{
                                position: "absolute",
                                top: "50%", transform: "translateY(-50%)",
                                left, width, height: 20, borderRadius: 4,
                                background: color,
                                opacity:  dimmed ? 0.28 : tentative ? 0.62 : 0.88,
                                cursor:   "pointer",
                                display:  "flex", alignItems: "center",
                                paddingLeft: 5, overflow: "hidden",
                                fontSize: 10, color: "#fff", fontWeight: 500,
                                zIndex: isSelected ? 4 : 2,
                                outline:       isSelected ? "2px solid hsl(var(--foreground))" : undefined,
                                outlineOffset: isSelected ? 1 : undefined,
                                boxShadow:     isSelected ? "0 0 0 2px hsl(var(--background))" : undefined,
                                textDecoration: dimmed ? "line-through" : undefined,
                                transition: "opacity 0.15s, outline 0.15s, box-shadow 0.15s",
                              }}
                            >
                              {barLabel}
                            </div>
                          );
                        })}
                      </>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {selectedBooking && (
        <BookingDetailPanel
          booking={selectedBooking.booking}
          resourceName={selectedBooking.resourceName}
          projectLabel={getProjectLabel(selectedBooking.booking)}
          onClose={() => setSelectedBooking(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "month";

export default function TerminuebersichtPage() {
  const { t } = useTranslation();
  const [viewMode, setViewMode]          = useState<ViewMode>("month");
  const [filterOpen, setFilterOpen]      = useState(false);
  const [selResTypeIds, setSelResTypeIds] = useState<Set<string>>(new Set());
  const [selSrcGroups, setSelSrcGroups]  = useState<Set<SourceGroup>>(new Set());

  // ── Data fetching ──────────────────────────────────────────────────────────
  const { data: bookingsResult, isLoading: loadingBk } =
    useListNuResourceBookings({ limit: 500 });

  const { data: localProjectsResult } =
    useListNuLocalProjects({ limit: 200 });

  const { data: resourcesRaw } = useListResources();

  const { data: resourceTypesResult } = useListResourceTypes();

  // Load TaktRequests to resolve project names for TAKT_REQUEST bookings
  const { data: taktRequests } = useListTaktRequests(
    { role: "nu" } as any,
    {
      query: {
        queryKey: getListTaktRequestsQueryKey({ role: "nu" } as any),
        refetchInterval: 60_000,
        refetchIntervalInBackground: false,
      },
    },
  );

  const bookings        = bookingsResult?.items ?? [];
  const localProjects: NuLocalProject[] = localProjectsResult?.items ?? [];
  const resources       = (resourcesRaw ?? []) as any[];          // includes resourceTypeId at runtime
  const resourceTypes: ResourceTypeRecord[] = resourceTypesResult?.items ?? [];
  const taktList: any[] = (taktRequests ?? []) as any[];

  // ── Lookup maps ────────────────────────────────────────────────────────────
  const localProjectMap = useMemo(
    () => new Map(localProjects.map((p) => [p.id, p.displayName])),
    [localProjects],
  );

  const taktProjectMap = useMemo(() => {
    const m = new Map<string, string>();
    taktList.forEach((req: any) => {
      if (req?.id && req?.projectName) m.set(req.id, req.projectName);
    });
    return m;
  }, [taktList]);

  // ── Build sections ─────────────────────────────────────────────────────────
  const sections = useMemo((): ResourceSection[] => {
    // 1. Filter bookings by selected source group
    const filteredBookings = bookings.filter((b) => {
      if (selSrcGroups.size === 0) return true;
      return selSrcGroups.has(getSourceGroup(b.sourceType));
    });

    // 2. Group filtered bookings by resourceId
    const bookingsByResource = new Map<string, NuResourceBooking[]>();
    filteredBookings.forEach((b) => {
      if (!b.resourceId) return;
      const arr = bookingsByResource.get(b.resourceId) ?? [];
      arr.push(b);
      bookingsByResource.set(b.resourceId, arr);
    });

    // 3. Build a resourceType lookup map
    const typeMap = new Map(resourceTypes.map((rt) => [rt.id, rt]));

    // 4. Group resources into sections by their resourceTypeId
    const sectionMap = new Map<
      string,
      { name: string; sortKey: number; resources: ResourceRow[] }
    >();

    resources.forEach((res: any) => {
      // Apply resource-type filter
      if (selResTypeIds.size > 0) {
        if (!res.resourceTypeId || !selResTypeIds.has(res.resourceTypeId)) return;
      }

      const booksForThis = bookingsByResource.get(res.id) ?? [];
      const typeId   = (res.resourceTypeId as string | null | undefined) ?? "__none__";
      const typeName =
        typeId === "__none__"
          ? "Ohne Zuordnung"
          : (typeMap.get(typeId)?.name ?? "Unbekannt");

      if (!sectionMap.has(typeId)) {
        sectionMap.set(typeId, {
          name:    typeName,
          sortKey: typeId === "__none__" ? 9999 : 0,
          resources: [],
        });
      }
      sectionMap.get(typeId)!.resources.push({
        id:       res.id,
        name:     res.name,
        bookings: booksForThis,
      });
    });

    // Type-level bookings remain aggregate rows. They are deliberately not
    // assigned to a concrete resource.
    const typeLevel = new Map<string, NuResourceBooking[]>();
    filteredBookings.forEach((booking) => {
      if (booking.resourceId || !booking.resourceTypeId) return;
      typeLevel.set(booking.resourceTypeId, [
        ...(typeLevel.get(booking.resourceTypeId) ?? []),
        booking,
      ]);
    });
    for (const [typeId, typeBookings] of typeLevel) {
      const typeName = typeMap.get(typeId)?.name ?? "Unbekannter Ressourcentyp";
      if (selResTypeIds.size > 0 && !selResTypeIds.has(typeId)) continue;
      if (!sectionMap.has(typeId)) {
        sectionMap.set(typeId, { name: typeName, sortKey: 0, resources: [] });
      }
      sectionMap.get(typeId)!.resources.push({
        id: `type-level-${typeId}`,
        name: `${typeName} (Typ-Level)`,
        bookings: typeBookings,
        typeLevel: true,
      });
    }

    // 5. Sort sections (named types first, alphabetically; "Ohne Zuordnung" last)
    return Array.from(sectionMap.entries())
      .sort(([, a], [, b]) => a.sortKey - b.sortKey || a.name.localeCompare(b.name, "de"))
      .map(([id, v]) => ({ id, name: v.name, resources: v.resources }));
  }, [bookings, resources, resourceTypes, selResTypeIds, selSrcGroups]);

  // ── All dates (for timeline range) ────────────────────────────────────────
  const allDates = useMemo(() => {
    const out: { start: string; end: string }[] = [];
    sections.forEach((s) =>
      s.resources.forEach((r) =>
        r.bookings.forEach((b) => out.push({ start: b.startAt, end: b.endAt })),
      ),
    );
    return out;
  }, [sections]);

  // ── Filter toggle helpers ──────────────────────────────────────────────────
  const toggleResType = (id: string) =>
    setSelResTypeIds((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const toggleSrcGroup = (id: SourceGroup) =>
    setSelSrcGroups((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const activeFilterCount = selResTypeIds.size + selSrcGroups.size;

  const activeResTypes = resourceTypes.filter((rt) => rt.active);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1600px] mx-auto">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">{t("gantt.title")}</h1>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Filter button */}
          <button
            onClick={() => setFilterOpen((o) => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-sm transition-colors ${
              activeFilterCount > 0
                ? "border-primary text-primary bg-primary/5"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            Filter
            {activeFilterCount > 0 && (
              <span className="bg-primary text-primary-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center font-semibold">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* View mode switcher */}
          <div className="flex gap-1 bg-sidebar-accent p-1 rounded text-sm">
            {(["day", "week", "month"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded transition-colors ${
                  viewMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {mode === "day" ? "Tag" : mode === "week" ? "Woche" : "Monat"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Filter panel ────────────────────────────────────────────────── */}
      {filterOpen && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">

            {/* Ressourcentyp */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
                Ressourcentyp
              </div>
              {activeResTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Keine Ressourcentypen vorhanden
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {activeResTypes.map((rt) => {
                    const active = selResTypeIds.has(rt.id);
                    return (
                      <button
                        key={rt.id}
                        onClick={() => toggleResType(rt.id)}
                        className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                          active
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                        }`}
                      >
                        {rt.name}
                        {rt.category && (
                          <span className="ml-1 opacity-55">
                            · {CATEGORY_LABEL[rt.category] ?? rt.category}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Belegungsart */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2.5">
                Belegungsart
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SOURCE_FILTER_OPTIONS.map((opt) => {
                  const active = selSrcGroups.has(opt.id);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggleSrcGroup(opt.id)}
                      className="px-2.5 py-1 rounded text-xs border transition-colors"
                      style={
                        active
                          ? { background: opt.color, borderColor: opt.color, color: "#fff" }
                          : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {activeFilterCount > 0 && (
            <button
              onClick={() => {
                setSelResTypeIds(new Set());
                setSelSrcGroups(new Set());
              }}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
            >
              Alle Filter zurücksetzen
            </button>
          )}
        </div>
      )}

      {/* ── Legend ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground items-center">
        {SOURCE_FILTER_OPTIONS.map((opt) => (
          <span key={opt.id} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
              style={{ background: opt.color }}
            />
            {opt.label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0 bg-red-400/50 border border-red-500/60" />
          Überschneidung
        </span>
        <span className="opacity-50 ml-1">— Klick auf Balken für Details</span>
      </div>

      {/* ── Chart ───────────────────────────────────────────────────────── */}
      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0">
          {loadingBk ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <ResourceGantt
              sections={sections}
              allDates={allDates}
              viewMode={viewMode}
              localProjectMap={localProjectMap}
              taktProjectMap={taktProjectMap}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
