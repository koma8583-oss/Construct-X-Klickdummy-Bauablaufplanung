/**
 * Terminübersicht — Tab 1: Takttermine (TaktRequest bars from snapshot time windows)
 *                   Tab 2: Ressourcenbelegung (real resource_bookings rows)
 *
 * Task #118: renamed from "Gantt" to "Terminübersicht"; tabs renamed.
 * Task #119: Ressourcenbelegung tab now uses resource_bookings via
 *            useListResourceBookings(). Legacy assignments removed.
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useListTaktRequests,
  getListTaktRequestsQueryKey,
  useListNuResourceBookings,
  type NuResourceBooking,
} from "@workspace/api-client-react";

/** NuResourceBooking extended with fields joined from the resources table. */
interface ResourceBookingWithResource extends NuResourceBooking {
  resourceName: string | null;
  resourceColor: string | null;
}
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

// ── status colours ────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  SENT:                  "#f59e0b",
  DELIVERED:             "#f59e0b",
  DETAILS_RETRIEVED:     "#f59e0b",
  UNDER_REVIEW:          "#f59e0b",
  ACCEPTED:              "#10b981",
  ALTERNATIVES_PROPOSED: "#3b82f6",
  REJECTED:              "#ef4444",
  REVISION_REQUIRED:     "#f97316",
  CANCELLED:             "#9ca3af",
  EXPIRED:               "#6b7280",
  SUPERSEDED:            "#6b7280",
  DRAFT:                 "#d1d5db",
};

const STATUS_LABEL: Record<string, string> = {
  SENT:                  "Gesendet",
  DELIVERED:             "Zugestellt",
  DETAILS_RETRIEVED:     "Abgerufen",
  UNDER_REVIEW:          "In Prüfung",
  ACCEPTED:              "Angenommen",
  ALTERNATIVES_PROPOSED: "Gegenvorschlag",
  REJECTED:              "Abgelehnt",
  REVISION_REQUIRED:     "Überarbeitung",
  CANCELLED:             "Storniert",
  EXPIRED:               "Abgelaufen",
  SUPERSEDED:            "Ersetzt",
  DRAFT:                 "Entwurf",
};

/** Booking status → bar colour */
const BOOKING_STATUS_COLOR: Record<string, string> = {
  TENTATIVE:  "#f59e0b",
  CONFIRMED:  "#10b981",
  CANCELLED:  "#9ca3af",
};

/** Booking source type → label */
const SOURCE_TYPE_LABEL: Record<string, string> = {
  LOCAL_PROJECT: "Lokales Projekt",
  TAKT_REQUEST:  "Taktauftrag",
  MANUAL_BLOCK:  "Manuell blockiert",
  ABSENCE:       "Abwesenheit",
  MAINTENANCE:   "Wartung",
};

/** Ensure end is always strictly after start (gantt-task-react requirement). */
function safeEnd(start: Date, end: Date): Date {
  if (end <= start) {
    const next = new Date(start);
    next.setDate(next.getDate() + 1);
    return next;
  }
  return end;
}

export default function TerminuebersichtPage() {
  const { t } = useTranslation();
  const [tab, setTab]           = useState<"takttermine" | "belegungen">("takttermine");
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Month);

  const { data: taktRequests, isLoading: loadingTaktRequests } = useListTaktRequests(
    { role: "nu" } as any,
    {
      query: {
        queryKey: getListTaktRequestsQueryKey({ role: "nu" } as any),
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
      },
    },
  );

  const { data: bookingsResult, isLoading: loadingBookings } = useListNuResourceBookings({
    limit: 100,
  });

  // ── Takttermine bars (from snapshot time window) ──────────────────────────
  const taktTermineTasks = useMemo((): Task[] => {
    if (!taktRequests || taktRequests.length === 0) return [];

    const projectMap = new Map<string, { name: string; start: Date; end: Date }>();

    taktRequests.forEach((req) => {
      const projId   = req.projectId ?? "unknown";
      const projName = req.projectName ?? "Unbekanntes Projekt";
      // Prefer snapshot time window (geplanter Ausführungszeitraum); fall back to request dates
      const snapPayload = (req as any).snapshotPayload as Record<string, unknown> | undefined;
      const tw = snapPayload?.plannedTimeWindow as Record<string, unknown> | undefined;
      const startStr = (tw?.start ?? req.sentAt ?? req.createdAt) as string;
      const endStr   = (tw?.end   ?? req.responseRequiredBy ?? req.expiresAt ?? req.updatedAt) as string;
      const start    = new Date(startStr);
      const end      = safeEnd(start, new Date(endStr));

      const existing = projectMap.get(projId);
      if (!existing) {
        projectMap.set(projId, { name: projName, start, end });
      } else {
        if (start < existing.start) existing.start = start;
        if (end   > existing.end)   existing.end   = end;
      }
    });

    const tasks: Task[] = [];

    projectMap.forEach((proj, projId) => {
      tasks.push({
        id:           `proj_${projId}`,
        name:         proj.name,
        type:         "project",
        start:        proj.start,
        end:          safeEnd(proj.start, proj.end),
        progress:     100,
        hideChildren: false,
        styles: {
          backgroundColor:         "transparent",
          progressColor:           "transparent",
          backgroundSelectedColor: "transparent",
        },
      });
    });

    taktRequests.forEach((req) => {
      const projId     = req.projectId ?? "unknown";
      const snapPayload = (req as any).snapshotPayload as Record<string, unknown> | undefined;
      const tw = snapPayload?.plannedTimeWindow as Record<string, unknown> | undefined;
      const startStr = (tw?.start ?? req.sentAt ?? req.createdAt) as string;
      const endStr   = (tw?.end   ?? req.responseRequiredBy ?? req.expiresAt ?? req.updatedAt) as string;
      const start    = new Date(startStr);
      const end      = safeEnd(start, new Date(endStr));
      const color    = STATUS_COLOR[req.status] ?? "#6b7280";
      const label    = [req.taktBezeichnung, req.requestNumber].filter(Boolean).join(" · ");

      tasks.push({
        id:      req.id,
        name:    label || "Takt",
        type:    "task",
        start,
        end,
        progress: 100,
        project: `proj_${projId}`,
        styles: {
          backgroundColor:         color,
          progressColor:           color,
          backgroundSelectedColor: color,
        },
      });
    });

    return tasks;
  }, [taktRequests]);

  // ── Ressourcenbelegung (real resource_bookings rows) ──────────────────────
  const belegungTasks = useMemo((): Task[] => {
    // Cast to extended type to access joined resourceName / resourceColor fields
    const bookings = bookingsResult?.items as ResourceBookingWithResource[] | undefined;
    if (!bookings || bookings.length === 0) return [];

    // Group bookings by resource to create parent "project" rows
    const resourceMap = new Map<string, { name: string; start: Date; end: Date }>();

    bookings.forEach((b: ResourceBookingWithResource) => {
      const start = new Date(b.startAt);
      const end   = safeEnd(start, new Date(b.endAt));

      const existing = resourceMap.get(b.resourceId);
      if (!existing) {
        resourceMap.set(b.resourceId, {
          name: b.resourceName ?? b.resourceId,
          start,
          end,
        });
      } else {
        if (start < existing.start) existing.start = start;
        if (end   > existing.end)   existing.end   = end;
      }
    });

    const tasks: Task[] = [];

    resourceMap.forEach((res, resId) => {
      tasks.push({
        id:           `res_${resId}`,
        name:         res.name,
        type:         "project",
        start:        res.start,
        end:          safeEnd(res.start, res.end),
        progress:     100,
        hideChildren: false,
        styles: {
          backgroundColor:         "transparent",
          progressColor:           "transparent",
          backgroundSelectedColor: "transparent",
        },
      });
    });

    bookings.forEach((b: ResourceBookingWithResource) => {
      const color = b.resourceColor ?? BOOKING_STATUS_COLOR[b.status] ?? "#10b981";
      const start = new Date(b.startAt);
      const end   = safeEnd(start, new Date(b.endAt));
      const label = [
        SOURCE_TYPE_LABEL[b.sourceType] ?? b.sourceType,
        b.utilizationPercent < 100 ? `${b.utilizationPercent}%` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      tasks.push({
        id:      b.id,
        name:    label || "Buchung",
        type:    "task",
        start,
        end,
        progress: 100,
        project: `res_${b.resourceId}`,
        styles: {
          backgroundColor:         color,
          progressColor:           color,
          backgroundSelectedColor: color,
        },
      });
    });

    return tasks;
  }, [bookingsResult]);

  const isLoading = tab === "takttermine" ? loadingTaktRequests : loadingBookings;
  const tasks     = tab === "takttermine" ? taktTermineTasks    : belegungTasks;

  const colWidth = viewMode === ViewMode.Day ? 60
                 : viewMode === ViewMode.Week ? 200
                 : 300;

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-foreground">{t("gantt.title")}</h1>

          {/* Tab switcher */}
          <div className="flex gap-1 bg-sidebar-accent p-1 rounded text-sm">
            <button
              className={`px-3 py-1 rounded transition-colors ${
                tab === "takttermine"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab("takttermine")}
            >
              Takttermine
            </button>
            <button
              className={`px-3 py-1 rounded transition-colors ${
                tab === "belegungen"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab("belegungen")}
            >
              Ressourcenbelegung
            </button>
          </div>
        </div>

        {/* View mode */}
        <div className="flex gap-1 bg-sidebar-accent p-1 rounded text-sm">
          {([ViewMode.Day, ViewMode.Week, ViewMode.Month] as const).map((mode) => (
            <button
              key={mode}
              className={`px-3 py-1 rounded transition-colors ${
                viewMode === mode
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setViewMode(mode)}
            >
              {mode === ViewMode.Day ? "Tag" : mode === ViewMode.Week ? "Woche" : "Monat"}
            </button>
          ))}
        </div>
      </div>

      {/* Status legend (takttermine tab only) */}
      {tab === "takttermine" && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {Object.entries(STATUS_COLOR).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              {STATUS_LABEL[status]}
            </span>
          ))}
        </div>
      )}

      {/* Booking status legend (belegungen tab only) */}
      {tab === "belegungen" && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {Object.entries(BOOKING_STATUS_COLOR).map(([status, color]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              {status === "TENTATIVE" ? "Vorläufig" : status === "CONFIRMED" ? "Bestätigt" : "Storniert"}
            </span>
          ))}
        </div>
      )}

      {/* Chart */}
      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : tasks.length > 0 ? (
            <div className="gantt-container" style={{ minWidth: "800px" }}>
              <Gantt
                tasks={tasks}
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
            <div className="p-8 text-center text-muted-foreground">
              {tab === "takttermine"
                ? "Keine Takttermine gefunden."
                : "Keine Ressourcenbelegungen gefunden."}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dark-mode overrides for gantt-task-react */}
      <style dangerouslySetInnerHTML={{ __html: `
        .gantt-container {
          --gantt-background: hsl(var(--card));
          --gantt-border-color: hsl(var(--border));
          --gantt-text-color: hsl(var(--foreground));
        }
        .gantt ._3w-y_ { fill: var(--gantt-background); }
        .gantt ._2P-5r, .gantt ._1X-d_ { stroke: var(--gantt-border-color); }
        .gantt ._2v0Xf { fill: var(--gantt-text-color); }
        .gantt ._1bV_q { fill: hsl(var(--muted)); }
        .gantt ._3T-i_ { fill: hsl(var(--muted)); }
      `}} />
    </div>
  );
}
