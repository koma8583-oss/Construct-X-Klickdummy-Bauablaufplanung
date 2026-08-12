/**
 * Terminübersicht — Unified Gantt
 *
 * Single chart combining:
 *   1. Takttermine  — one group per project, one bar per TaktRequest
 *   2. Externe Projekte  — resource bookings with sourceType TAKT_REQUEST
 *   3. Interne Projekte  — resource bookings with sourceType LOCAL_PROJECT
 *   4. Allgemeine Belegungen — all other bookings
 *
 * Left column: name only — no From/To date columns.
 * Click a bar → detail panel slides in below the chart.
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
  useListTaktRequests,
  getListTaktRequestsQueryKey,
  useListNuResourceBookings,
  useListNuLocalProjects,
  useListResources,
  type NuResourceBooking,
  type NuLocalProject,
  type Resource,
} from "@workspace/api-client-react";
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
  CalendarClock,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Colour maps
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  SENT: "#f59e0b", DELIVERED: "#f59e0b", DETAILS_RETRIEVED: "#f59e0b",
  UNDER_REVIEW: "#f59e0b", ACCEPTED: "#10b981",
  ALTERNATIVES_PROPOSED: "#3b82f6", REJECTED: "#ef4444",
  REVISION_REQUIRED: "#f97316", CANCELLED: "#9ca3af",
  EXPIRED: "#6b7280", SUPERSEDED: "#6b7280", DRAFT: "#d1d5db",
};
const STATUS_LABEL: Record<string, string> = {
  SENT: "Gesendet", DELIVERED: "Zugestellt", DETAILS_RETRIEVED: "Abgerufen",
  UNDER_REVIEW: "In Prüfung", ACCEPTED: "Angenommen",
  ALTERNATIVES_PROPOSED: "Gegenvorschlag", REJECTED: "Abgelehnt",
  REVISION_REQUIRED: "Überarbeitung", CANCELLED: "Storniert",
  EXPIRED: "Abgelaufen", SUPERSEDED: "Ersetzt", DRAFT: "Entwurf",
};

const BOOKING_COLOR: Record<string, string> = {
  TENTATIVE: "#f59e0b", CONFIRMED: "#10b981", CANCELLED: "#9ca3af",
};
const BOOKING_LABEL: Record<string, string> = {
  TENTATIVE: "Vorläufig", CONFIRMED: "Bestätigt", CANCELLED: "Storniert",
};

const SOURCE_LABEL: Record<string, string> = {
  LOCAL_PROJECT: "Lokales Projekt", TAKT_REQUEST: "Taktauftrag",
  MANUAL_BLOCK: "Manuell blockiert", ABSENCE: "Abwesenheit", MAINTENANCE: "Wartung",
};

// ─────────────────────────────────────────────────────────────────────────────
// Data types
// ─────────────────────────────────────────────────────────────────────────────

interface EnrichedBooking extends NuResourceBooking {
  resourceName: string;
  groupName: string;
}

interface EnrichedTakt {
  id: string;
  label: string;
  startAt: string;
  endAt: string;
  status: string;
  projectId: string;
  projectName: string;
  groupName: string;
  zone?: string | null;
  gewerk?: string | null;
  requestNumber?: string | null;
}

type GanttItem =
  | { kind: "booking"; data: EnrichedBooking }
  | { kind: "takt";    data: EnrichedTakt };

interface GanttGroup  { id: string; name: string; items: GanttItem[] }
interface GanttSection {
  id: string;
  label: string;
  Icon: React.ElementType;
  accentColor: string;
  bgColor: string;
  groups: GanttGroup[];
}

type GanttRow =
  | { kind: "section"; section: GanttSection }
  | { kind: "group";   section: GanttSection; group: GanttGroup }
  | { kind: "item";    section: GanttSection; group: GanttGroup; item: GanttItem };

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
function safeEndIso(start: string, end: string): string {
  const s = new Date(start); const e = new Date(end);
  if (e <= s) { const d = new Date(s); d.setDate(d.getDate() + 1); return d.toISOString(); }
  return end;
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
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0);
    while (d <= end) {
      const left = differenceInCalendarDays(d, start) * pxPerDay;
      if (left >= 0) ticks.push({ left, label: format(d, "d. MMM", { locale: de }) });
      d = addDays(d, 7);
    }
  }
  return ticks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────────────────────

function DetailPanel({ item, onClose }: { item: GanttItem; onClose: () => void }) {
  if (item.kind === "takt") {
    const t = item.data;
    return (
      <div className="border-t border-border bg-card px-5 py-4 animate-in slide-in-from-bottom-2 duration-200">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <div className="text-sm font-semibold">{t.label}</div>
            <div className="text-xs text-muted-foreground">{t.projectName}</div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Zeitraum</div>
            <div className="font-medium">{fmtDate(t.startAt)}<span className="text-muted-foreground mx-1">–</span>{fmtDate(t.endAt)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Status</div>
            <div className="font-medium" style={{ color: STATUS_COLOR[t.status] ?? "#6b7280" }}>
              {STATUS_LABEL[t.status] ?? t.status}
            </div>
          </div>
          {t.zone && (
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Zone</div>
              <div className="font-medium">{t.zone}</div>
            </div>
          )}
          {t.gewerk && (
            <div>
              <div className="text-xs text-muted-foreground mb-0.5">Gewerk</div>
              <div className="font-medium">{t.gewerk}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const b = item.data;
  const allDay = isAllDay(b.startAt, b.endAt);
  return (
    <div className="border-t border-border bg-card px-5 py-4 animate-in slide-in-from-bottom-2 duration-200">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="text-sm font-semibold">{b.resourceName}</div>
          <div className="text-xs text-muted-foreground">{SOURCE_LABEL[b.sourceType] ?? b.sourceType}</div>
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors mt-0.5">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm">
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">Zeitraum</div>
          <div className="font-medium">
            {allDay
              ? <span className="flex items-center gap-1">{fmtDate(b.startAt)}<span className="text-xs bg-muted px-1 rounded">Ganztägig</span></span>
              : <>{fmtDt(b.startAt)}<br /><span className="text-muted-foreground">bis </span>{fmtDt(b.endAt)}</>
            }
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">Status</div>
          <div className="font-medium" style={{ color: BOOKING_COLOR[b.status] }}>
            {BOOKING_LABEL[b.status] ?? b.status}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-0.5">Auslastung</div>
          <div className={`font-medium ${b.utilizationPercent > 100 ? "text-red-600" : ""}`}>
            {b.utilizationPercent}%
          </div>
        </div>
        {b.note && (
          <div>
            <div className="text-xs text-muted-foreground mb-0.5">Notiz</div>
            <div className="text-sm">{b.note}</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified Gantt component
// ─────────────────────────────────────────────────────────────────────────────

const ROW_H     = 36;
const SECTION_H = 44;
const HEADER_H  = 52;
const LEFT_W    = 248;

function UnifiedGantt({
  sections,
  allDates,
  viewMode,
}: {
  sections: GanttSection[];
  allDates: { start: string; end: string }[];
  viewMode: "day" | "week" | "month";
}) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(sections.map((s) => s.id)),
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedItem, setSelectedItem] = useState<GanttItem | null>(null);

  // IDs of booking bars that belong to the currently selected Takt bar
  const highlightedBookingIds = useMemo(() => {
    if (!selectedItem || selectedItem.kind !== "takt") return new Set<string>();
    const taktId = selectedItem.data.id;
    const ids = new Set<string>();
    sections.forEach((section) =>
      section.groups.forEach((group) =>
        group.items.forEach((item) => {
          if (
            item.kind === "booking" &&
            item.data.sourceType === "TAKT_REQUEST" &&
            item.data.sourceReferenceId === taktId
          ) {
            ids.add(item.data.id);
          }
        }),
      ),
    );
    return ids;
  }, [selectedItem, sections]);

  // Expand all groups once sections are known
  useEffect(() => {
    const ids = new Set<string>();
    sections.forEach((s) => s.groups.forEach((g) => ids.add(`${s.id}::${g.id}`)));
    setExpandedGroups(ids);
  }, [sections]);

  useEffect(() => {
    setExpandedSections(new Set(sections.map((s) => s.id)));
  }, [sections]);

  const toggleSection = (id: string) =>
    setExpandedSections((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleGroup = (id: string) =>
    setExpandedGroups((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Date range ──────────────────────────────────────────────────────────
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
      rangeEnd: rEnd,
      totalDays: differenceInCalendarDays(rEnd, rStart) + 1,
      pxPerDay: px,
    };
  }, [allDates, viewMode]);

  const totalWidth = totalDays * pxPerDay;
  const monthSegs  = useMemo(() => buildMonthSegments(rangeStart, rangeEnd, pxPerDay), [rangeStart, rangeEnd, pxPerDay]);
  const ticks      = useMemo(() => buildTicks(rangeStart, rangeEnd, pxPerDay, viewMode), [rangeStart, rangeEnd, pxPerDay, viewMode]);
  const showTicks  = viewMode !== "month";

  // ── Bar geometry ────────────────────────────────────────────────────────
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

  // ── Flat rows ───────────────────────────────────────────────────────────
  const rows = useMemo((): GanttRow[] => {
    const out: GanttRow[] = [];
    sections.forEach((section) => {
      out.push({ kind: "section", section });
      if (!expandedSections.has(section.id)) return;
      section.groups.forEach((group) => {
        out.push({ kind: "group", section, group });
        if (!expandedGroups.has(`${section.id}::${group.id}`)) return;
        group.items.forEach((item) => out.push({ kind: "item", section, group, item }));
      });
    });
    return out;
  }, [sections, expandedSections, expandedGroups]);

  if (!sections.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <CalendarDays className="w-12 h-12 text-muted-foreground opacity-30" />
        <p className="text-muted-foreground text-sm">Keine Daten gefunden.</p>
      </div>
    );
  }

  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div className="flex flex-col overflow-hidden" style={{ maxHeight: "calc(100vh - 260px)", minHeight: 320 }}>
      <div ref={scrollRef} className="overflow-auto flex-1" style={{ position: "relative" }}>

        {/* ── Sticky timeline header ──────────────────────────────────────── */}
        <div style={{
          position: "sticky", top: 0, zIndex: 20, display: "flex",
          height: HEADER_H, background: "hsl(var(--card))",
          borderBottom: "1px solid hsl(var(--border))",
          minWidth: LEFT_W + totalWidth,
        }}>
          {/* Corner */}
          <div style={{
            position: "sticky", left: 0, width: LEFT_W, flexShrink: 0, zIndex: 30,
            background: "hsl(var(--card))", borderRight: "1px solid hsl(var(--border))",
          }} />
          {/* Month + tick area */}
          <div style={{ position: "relative", width: totalWidth, flexShrink: 0 }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: showTicks ? 26 : HEADER_H, overflow: "hidden" }}>
              {monthSegs.map((seg, i) => (
                <div key={i} style={{
                  position: "absolute", left: seg.left, width: seg.width, height: "100%",
                  borderRight: "1px solid hsl(var(--border))", paddingLeft: 6,
                  display: "flex", alignItems: "center", fontSize: 11, fontWeight: 600,
                  color: "hsl(var(--muted-foreground))", textTransform: "capitalize",
                  overflow: "hidden", whiteSpace: "nowrap",
                }}>
                  {seg.width > 40 ? seg.label : ""}
                </div>
              ))}
            </div>
            {showTicks && (
              <div style={{ position: "absolute", top: 26, left: 0, right: 0, height: HEADER_H - 26, overflow: "hidden" }}>
                {ticks.map((tick, i) => (
                  <div key={i} style={{
                    position: "absolute", left: tick.left, height: "100%", paddingLeft: 4,
                    display: "flex", alignItems: "center", fontSize: 10,
                    color: "hsl(var(--muted-foreground))", borderLeft: "1px solid hsl(var(--border))",
                  }}>
                    {tick.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Rows ───────────────────────────────────────────────────────── */}
        <div style={{ minWidth: LEFT_W + totalWidth }}>
          {rows.map((row, idx) => {
            const rowH = row.kind === "section" ? SECTION_H : ROW_H;

            // Collect span dates for section/group summary bars
            let spanItems: { startAt: string; endAt: string }[] = [];
            if (row.kind === "section") {
              spanItems = row.section.groups.flatMap((g) => g.items.map((it) =>
                it.kind === "booking"
                  ? { startAt: it.data.startAt, endAt: it.data.endAt }
                  : { startAt: it.data.startAt, endAt: it.data.endAt },
              ));
            } else if (row.kind === "group") {
              spanItems = row.group.items.map((it) =>
                it.kind === "booking"
                  ? { startAt: it.data.startAt, endAt: it.data.endAt }
                  : { startAt: it.data.startAt, endAt: it.data.endAt },
              );
            }

            return (
              <div key={idx} style={{
                display: "flex", height: rowH,
                borderBottom: "1px solid hsl(var(--border))", position: "relative",
              }}>
                {/* ── Left label (sticky) ─────────────────────────────────── */}
                <div
                  style={{
                    position: "sticky", left: 0, width: LEFT_W, flexShrink: 0, zIndex: 10,
                    background: row.kind === "section" ? row.section.bgColor : "hsl(var(--card))",
                    borderRight: "1px solid hsl(var(--border))",
                    display: "flex", alignItems: "center", paddingRight: 8,
                    ...(row.kind === "section"
                      ? { borderLeft: `3px solid ${row.section.accentColor}`, paddingLeft: 10 }
                      : row.kind === "group"
                      ? { paddingLeft: 24 }
                      : { paddingLeft: 40 }),
                  }}
                  onClick={
                    row.kind === "section" ? () => toggleSection(row.section.id)
                    : row.kind === "group"  ? () => toggleGroup(`${row.section.id}::${row.group.id}`)
                    : undefined
                  }
                  className={row.kind !== "item" ? "cursor-pointer hover:brightness-95 transition-all select-none" : ""}
                >
                  {row.kind === "section" && (
                    <>
                      <row.section.Icon className="w-4 h-4 shrink-0 mr-2" style={{ color: row.section.accentColor }} />
                      <span className="text-xs font-semibold truncate flex-1" style={{ color: row.section.accentColor }}>
                        {row.section.label}
                      </span>
                      <span className="text-xs text-muted-foreground mr-1">
                        {row.section.groups.reduce((s, g) => s + g.items.length, 0)}
                      </span>
                      {expandedSections.has(row.section.id)
                        ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                    </>
                  )}
                  {row.kind === "group" && (
                    <>
                      {expandedGroups.has(`${row.section.id}::${row.group.id}`)
                        ? <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0 mr-1.5" />
                        : <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0 mr-1.5" />}
                      <span className="text-xs font-medium truncate flex-1">{row.group.name}</span>
                      <span className="text-xs text-muted-foreground ml-1 shrink-0">{row.group.items.length}</span>
                    </>
                  )}
                  {row.kind === "item" && (
                    <span className="text-xs text-muted-foreground truncate">
                      {row.item.kind === "takt" ? row.item.data.label : row.item.data.resourceName}
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
                      <div style={{
                        position: "absolute", top: 0, bottom: 0, left, width: 1,
                        background: "rgba(239,68,68,0.35)", zIndex: 1, pointerEvents: "none",
                      }} />
                    );
                  })()}

                  {/* Section / group span bar */}
                  {(row.kind === "section" || row.kind === "group") && spanItems.length > 0 && (() => {
                    const minS = Math.min(...spanItems.map((d) => new Date(d.startAt).getTime()));
                    const maxE = Math.max(...spanItems.map((d) => new Date(d.endAt).getTime()));
                    const { left, width } = barGeom(new Date(minS).toISOString(), new Date(maxE).toISOString());
                    return (
                      <div style={{
                        position: "absolute", top: "50%", transform: "translateY(-50%)",
                        left, width, height: row.kind === "section" ? 10 : 8,
                        borderRadius: 4, background: row.section.accentColor,
                        opacity: row.kind === "section" ? 0.18 : 0.12, pointerEvents: "none",
                      }} />
                    );
                  })()}

                  {/* Item bar */}
                  {row.kind === "item" && (() => {
                    const isSelected =
                      selectedItem?.kind === row.item.kind &&
                      (row.item.kind === "takt"
                        ? selectedItem.kind === "takt" && selectedItem.data.id === row.item.data.id
                        : selectedItem.kind === "booking" && selectedItem.data.id === row.item.data.id);

                    const isHighlighted =
                      !isSelected &&
                      row.item.kind === "booking" &&
                      highlightedBookingIds.has(row.item.data.id);

                    let startAt: string, endAt: string, color: string, label: string, dimmed = false;

                    if (row.item.kind === "takt") {
                      const t = row.item.data;
                      startAt = t.startAt; endAt = t.endAt;
                      color = STATUS_COLOR[t.status] ?? "#6b7280";
                      label = t.label;
                      dimmed = t.status === "CANCELLED" || t.status === "EXPIRED" || t.status === "SUPERSEDED";
                    } else {
                      const b = row.item.data;
                      startAt = b.startAt; endAt = b.endAt;
                      color = BOOKING_COLOR[b.status] ?? "#6b7280";
                      const aDay = isAllDay(b.startAt, b.endAt);
                      label = aDay ? "Ganztägig" : (SOURCE_LABEL[b.sourceType] ?? b.sourceType);
                      dimmed = b.status === "CANCELLED";
                    }

                    const { left, width } = barGeom(startAt, endAt);

                    return (
                      <div
                        onClick={() => setSelectedItem(isSelected ? null : row.item)}
                        title={label}
                        style={{
                          position: "absolute", top: "50%", transform: "translateY(-50%)",
                          left, width, height: 22, borderRadius: 4,
                          background: color,
                          opacity: isHighlighted ? 1 : dimmed ? 0.35 : 0.88,
                          cursor: "pointer", display: "flex", alignItems: "center",
                          paddingLeft: 5, overflow: "hidden", fontSize: 10,
                          color: "#fff", fontWeight: 500, zIndex: isHighlighted ? 3 : 2,
                          outline: isSelected
                            ? "2px solid hsl(var(--foreground))"
                            : isHighlighted
                            ? "2px solid #6366f1"
                            : undefined,
                          outlineOffset: isHighlighted ? 2 : 1,
                          boxShadow: isSelected
                            ? "0 0 0 2px hsl(var(--background))"
                            : isHighlighted
                            ? "0 0 0 2px hsl(var(--background)), 0 0 10px 3px rgba(99,102,241,0.55)"
                            : undefined,
                          transition: "opacity 0.15s, box-shadow 0.15s, outline 0.15s",
                        }}
                      >
                        {width > 30 ? label : ""}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail panel */}
      {selectedItem && (
        <DetailPanel item={selectedItem} onClose={() => setSelectedItem(null)} />
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
  const [viewMode, setViewMode] = useState<ViewMode>("month");

  const { data: taktRequests, isLoading: loadingTR } = useListTaktRequests(
    { role: "nu" } as any,
    { query: { queryKey: getListTaktRequestsQueryKey({ role: "nu" } as any), refetchInterval: 30_000, refetchIntervalInBackground: false } },
  );
  const { data: bookingsResult, isLoading: loadingBk } = useListNuResourceBookings({ limit: 200 });
  const { data: localProjectsResult } = useListNuLocalProjects({ limit: 200 });
  const { data: resources } = useListResources();

  const isLoading = loadingTR || loadingBk;

  const bookings        = bookingsResult?.items ?? [];
  const localProjects: NuLocalProject[] = localProjectsResult?.items ?? [];
  const resourceList: Resource[]        = resources ?? [];
  const taktList: any[] = (taktRequests ?? []) as any[];

  // ── Lookup maps ──────────────────────────────────────────────────────────
  const resourceMap = useMemo(
    () => new Map(resourceList.map((r) => [r.id, r.name])),
    [resourceList],
  );
  const localProjectMap = useMemo(
    () => new Map(localProjects.map((p) => [p.id, p.displayName])),
    [localProjects],
  );
  const taktProjectMap = useMemo(() => {
    const m = new Map<string, string>();
    taktList.forEach((req) => { if (req?.id && req?.projectName) m.set(req.id, req.projectName); });
    return m;
  }, [taktList]);

  // ── Build sections ───────────────────────────────────────────────────────
  const sections = useMemo((): GanttSection[] => {
    // 1. Takttermine
    const taktByProject = new Map<string, { name: string; items: GanttItem[] }>();
    taktList.forEach((req: any) => {
      const startStr = req.plannedStart ?? req.sentAt ?? req.createdAt;
      const endStr   = req.plannedEnd   ?? req.responseRequiredBy ?? req.expiresAt ?? req.updatedAt;
      if (!startStr || !endStr) return;
      const endIso = safeEndIso(startStr, endStr);
      const zone   = req.zone   as string | null;
      const gewerk = req.gewerk as string | null;
      const sub    = [zone, gewerk].filter(Boolean).join(" · ");
      const label  = req.taktBezeichnung
        ? (sub ? `${req.taktBezeichnung} – ${sub}` : req.taktBezeichnung)
        : (sub || req.requestNumber || "Takt");
      const projId   = req.projectId   ?? "unknown";
      const projName = req.projectName ?? "Unbekanntes Projekt";
      const takt: EnrichedTakt = {
        id: req.id, label, startAt: startStr, endAt: endIso,
        status: req.status ?? "DRAFT", projectId: projId, projectName: projName,
        groupName: projName, zone, gewerk, requestNumber: req.requestNumber,
      };
      const existing = taktByProject.get(projId);
      if (existing) { existing.items.push({ kind: "takt", data: takt }); }
      else { taktByProject.set(projId, { name: projName, items: [{ kind: "takt", data: takt }] }); }
    });
    const taktGroups: GanttGroup[] = Array.from(taktByProject.entries()).map(([id, v]) => ({
      id, name: v.name, items: v.items,
    }));

    // 2–4. Resource bookings
    const externalMap = new Map<string, GanttItem[]>();
    const internalMap = new Map<string, GanttItem[]>();
    const generalMap  = new Map<string, GanttItem[]>();

    bookings.forEach((b) => {
      const resourceName = (b.resourceId ? resourceMap.get(b.resourceId) : null) ?? "–";
      const enriched: EnrichedBooking = { ...b, resourceName, groupName: "" };

      if (b.sourceType === "TAKT_REQUEST") {
        const key = taktProjectMap.get(b.sourceReferenceId ?? "") ?? b.sourceReferenceId ?? "Unbekanntes Projekt";
        enriched.groupName = key;
        const arr = externalMap.get(key) ?? [];
        arr.push({ kind: "booking", data: enriched });
        externalMap.set(key, arr);
      } else if (b.sourceType === "LOCAL_PROJECT") {
        const key = b.localProjectId ? (localProjectMap.get(b.localProjectId) ?? b.localProjectId) : "Kein Projekt";
        enriched.groupName = key;
        const arr = internalMap.get(key) ?? [];
        arr.push({ kind: "booking", data: enriched });
        internalMap.set(key, arr);
      } else {
        const key = resourceName;
        enriched.groupName = key;
        const arr = generalMap.get(key) ?? [];
        arr.push({ kind: "booking", data: enriched });
        generalMap.set(key, arr);
      }
    });

    const toGroups = (m: Map<string, GanttItem[]>): GanttGroup[] =>
      Array.from(m.entries()).map(([name, items]) => ({ id: name, name, items }));

    const all: GanttSection[] = [
      {
        id: "takts", label: "Takttermine", Icon: CalendarClock,
        accentColor: "#6366f1", bgColor: "rgba(99,102,241,0.06)",
        groups: taktGroups,
      },
      {
        id: "external", label: "Externe Projekte (Ressourcen)", Icon: Building2,
        accentColor: "#8b5cf6", bgColor: "rgba(139,92,246,0.06)",
        groups: toGroups(externalMap),
      },
      {
        id: "internal", label: "Interne Projekte (Ressourcen)", Icon: FolderOpen,
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
  }, [taktList, bookings, resourceMap, localProjectMap, taktProjectMap]);

  // All date pairs for range calculation
  const allDates = useMemo(() => {
    const out: { start: string; end: string }[] = [];
    sections.forEach((s) =>
      s.groups.forEach((g) =>
        g.items.forEach((it) =>
          out.push(
            it.kind === "takt"
              ? { start: it.data.startAt, end: it.data.endAt }
              : { start: it.data.startAt, end: it.data.endAt },
          ),
        ),
      ),
    );
    return out;
  }, [sections]);

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">{t("gantt.title")}</h1>

        {/* View mode */}
        <div className="flex gap-1 bg-sidebar-accent p-1 rounded text-sm">
          {(["day", "week", "month"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded transition-colors ${
                viewMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {mode === "day" ? "Tag" : mode === "week" ? "Woche" : "Monat"}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="font-medium text-foreground/70">Takttermine:</span>
        {["ACCEPTED", "UNDER_REVIEW", "ALTERNATIVES_PROPOSED", "REJECTED", "CANCELLED"].map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STATUS_COLOR[s] }} />
            {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="mx-1 text-border">|</span>
        <span className="font-medium text-foreground/70">Belegungen:</span>
        {Object.entries(BOOKING_COLOR).map(([s, c]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />
            {BOOKING_LABEL[s]}
          </span>
        ))}
        <span className="text-muted-foreground opacity-60 ml-1">— Klick auf Balken für Details</span>
      </div>

      {/* Chart */}
      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <UnifiedGantt sections={sections} allDates={allDates} viewMode={viewMode} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
