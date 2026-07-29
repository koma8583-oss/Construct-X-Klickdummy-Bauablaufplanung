import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useListResourceAssignments,
  useListDelegations,
} from "@workspace/api-client-react";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

// ── status colours ────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  PENDING:              "#f59e0b",
  CONFIRMED:            "#10b981",
  ALTERNATIVE_PROPOSED: "#3b82f6",
  REJECTED:             "#6b7280",
  CANCELLED:            "#9ca3af",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING:              "Ausstehend",
  CONFIRMED:            "Bestätigt",
  ALTERNATIVE_PROPOSED: "Gegenvorschlag",
  REJECTED:             "Abgelehnt",
  CANCELLED:            "Storniert",
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

export default function GanttPage() {
  const { t } = useTranslation();
  const [tab, setTab]           = useState<"requests" | "assignments">("requests");
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Month);

  const { data: assignments, isLoading: loadingAssignments } = useListResourceAssignments();
  const { data: delegations, isLoading: loadingDelegations  } = useListDelegations();

  // ── delegation tasks ────────────────────────────────────────────────────────
  const delegationTasks = useMemo((): Task[] => {
    if (!delegations || delegations.length === 0) return [];

    // Filter out cancelled/rejected so the chart stays readable;
    // keep them but grey them out instead.
    const projectMap = new Map<string, { name: string; start: Date; end: Date }>();

    delegations.forEach((d) => {
      const projId   = (d as any).project?.id ?? "unknown";
      const projName = (d as any).project?.name ?? "Unbekanntes Projekt";
      const start    = new Date(d.requestedStart);
      const end      = safeEnd(start, new Date(d.requestedEnd));

      const existing = projectMap.get(projId);
      if (!existing) {
        projectMap.set(projId, { name: projName, start, end });
      } else {
        if (start < existing.start) existing.start = start;
        if (end   > existing.end)   existing.end   = end;
      }
    });

    const tasks: Task[] = [];

    // Project header rows
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
          backgroundColor:     "transparent",
          progressColor:       "transparent",
          backgroundSelectedColor: "transparent",
        },
      });
    });

    // Delegation bars
    delegations.forEach((d) => {
      const projId = (d as any).project?.id ?? "unknown";
      const takt   = (d as any).takt;
      const label  = [takt?.gewerk, takt?.zone, takt?.taktBezeichnung]
        .filter(Boolean)
        .join(" · ");
      const start  = new Date(d.requestedStart);
      const end    = safeEnd(start, new Date(d.requestedEnd));
      const color  = STATUS_COLOR[d.status] ?? "#6b7280";

      tasks.push({
        id:       d.id,
        name:     label || "Takt",
        type:     "task",
        start,
        end,
        progress: 100,
        project:  `proj_${projId}`,
        styles: {
          backgroundColor:          color,
          progressColor:            color,
          backgroundSelectedColor:  color,
        },
      });
    });

    return tasks;
  }, [delegations]);

  // ── resource assignment tasks ───────────────────────────────────────────────
  const assignmentTasks = useMemo((): Task[] => {
    if (!assignments || assignments.length === 0) return [];

    const resourceMap = new Map<string, { name: string; start: Date; end: Date }>();

    assignments.forEach((a) => {
      if (!a.resource) return;
      const id    = a.resource.id;
      const start = new Date(a.fromDate);
      const end   = safeEnd(start, new Date(a.toDate));

      const existing = resourceMap.get(id);
      if (!existing) {
        resourceMap.set(id, { name: a.resource.name, start, end });
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
          backgroundColor:     "transparent",
          progressColor:       "transparent",
          backgroundSelectedColor: "transparent",
        },
      });
    });

    assignments.forEach((a) => {
      if (!a.resource || !a.delegation) return;
      const takt  = (a.delegation as any).takt;
      const label = [takt?.gewerk, takt?.zone].filter(Boolean).join(" – ");
      const color = a.resource.color ?? "#10b981";
      const start = new Date(a.fromDate);
      const end   = safeEnd(start, new Date(a.toDate));

      tasks.push({
        id:      a.id,
        name:    label || "Zuweisung",
        type:    "task",
        start,
        end,
        progress: 100,
        project: `res_${a.resource.id}`,
        styles: {
          backgroundColor:         color,
          progressColor:           color,
          backgroundSelectedColor: color,
        },
      });
    });

    return tasks;
  }, [assignments]);

  const isLoading = tab === "requests" ? loadingDelegations : loadingAssignments;
  const tasks     = tab === "requests" ? delegationTasks    : assignmentTasks;

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
                tab === "requests"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab("requests")}
            >
              Anfragen
            </button>
            <button
              className={`px-3 py-1 rounded transition-colors ${
                tab === "assignments"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setTab("assignments")}
            >
              Zuweisungen
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

      {/* Status legend (requests tab only) */}
      {tab === "requests" && (
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
              {tab === "requests" ? "Keine Anfragen gefunden." : t("gantt.empty")}
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
