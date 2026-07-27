import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useListResourceAssignments } from "@workspace/api-client-react";
import { Gantt, Task, ViewMode } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export default function GanttPage() {
  const { t } = useTranslation();
  const { data: assignments, isLoading } = useListResourceAssignments();
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.Day);

  const tasks = useMemo(() => {
    if (!assignments || assignments.length === 0) return [];
    
    const taskList: Task[] = [];
    const resourceMap = new Map<string, any>();

    // First collect all unique resources from assignments
    assignments.forEach(a => {
      if (a.resource) {
        if (!resourceMap.has(a.resource.id)) {
          resourceMap.set(a.resource.id, a.resource);
          // Add Resource as project header
          taskList.push({
            id: `res_${a.resource.id}`,
            name: a.resource.name,
            type: 'project',
            start: new Date(a.fromDate), // will adjust below
            end: new Date(a.toDate),
            progress: 100,
            hideChildren: false,
            styles: { backgroundColor: 'transparent', progressColor: 'transparent' }
          });
        }
      }
    });

    // Then add assignments
    assignments.forEach(a => {
      if (a.resource && a.delegation) {
        taskList.push({
          id: a.id,
          name: `${a.delegation.takt?.gewerk || 'Gewerk'} - ${a.delegation.takt?.zone || 'Zone'}`,
          type: 'task',
          start: new Date(a.fromDate),
          end: new Date(a.toDate),
          progress: 100,
          project: `res_${a.resource?.id}`,
          styles: { 
            backgroundColor: a.resource?.color || '#10b981',
            progressColor: a.resource?.color || '#10b981'
          }
        });
        
        // Update resource project dates to encompass all its tasks
        const proj = taskList.find(t => t.id === `res_${a.resource?.id}`);
        if (proj) {
          const start = new Date(a.fromDate);
          const end = new Date(a.toDate);
          if (start < proj.start) proj.start = start;
          if (end > proj.end) proj.end = end;
        }
      }
    });

    return taskList;
  }, [assignments]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-foreground">{t("gantt.title")}</h1>
        <div className="flex gap-2 bg-sidebar-accent p-1 rounded">
          <button 
            className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Day ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            onClick={() => setViewMode(ViewMode.Day)}
          >
            Tag
          </button>
          <button 
            className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Week ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            onClick={() => setViewMode(ViewMode.Week)}
          >
            Woche
          </button>
          <button 
            className={`px-3 py-1 rounded text-sm ${viewMode === ViewMode.Month ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            onClick={() => setViewMode(ViewMode.Month)}
          >
            Monat
          </button>
        </div>
      </div>

      <Card className="bg-card border-border overflow-hidden">
        <CardContent className="p-0 overflow-x-auto">
          {tasks.length > 0 ? (
            <div className="gantt-container" style={{ minWidth: '800px' }}>
              <Gantt
                tasks={tasks}
                viewMode={viewMode}
                locale="de"
                columnWidth={viewMode === ViewMode.Day ? 60 : viewMode === ViewMode.Week ? 200 : 300}
                listCellWidth="200px"
                rowHeight={40}
                barFill={70}
                barCornerRadius={4}
              />
            </div>
          ) : (
            <div className="p-8 text-center text-muted-foreground">
              {t("gantt.empty")}
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* Required style overrides for dark mode since gantt-task-react defaults to light */}
      <style dangerouslySetInnerHTML={{__html: `
        .gantt-container {
          --gantt-background: hsl(var(--card));
          --gantt-border-color: hsl(var(--border));
          --gantt-text-color: hsl(var(--foreground));
        }
        .gantt ._3w-y_ { fill: var(--gantt-background); } /* background */
        .gantt ._2P-5r, .gantt ._1X-d_ { stroke: var(--gantt-border-color); } /* grid lines */
        .gantt ._2v0Xf { fill: var(--gantt-text-color); } /* text */
        .gantt ._1bV_q { fill: var(--gantt-border-color); } /* list background */
        .gantt ._3T-i_ { fill: hsl(var(--muted)); } /* weekend */
      `}} />
    </div>
  );
}
