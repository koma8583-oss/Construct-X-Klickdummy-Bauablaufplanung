import { useQuery } from "@tanstack/react-query";
import { getCoordinationTasks, type CoordinationTask } from "@workspace/api-client-react";
import { AlertTriangle, CheckCircle2, Clock3, ListTodo } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const taskLabels: Record<CoordinationTask["taskType"], string> = {
  RESPOND_TO_REQUEST: "Anfrage beantworten",
  DECIDE_RESPONSE: "Antwort entscheiden",
  RESPOND_TO_CHANGE_PROPOSAL: "Änderungsvorschlag beantworten",
  RESOLVE_CONSTRAINT: "Risiko bearbeiten",
  ANSWER_CLARIFICATION: "Rückfrage beantworten",
  CONFIRM_READINESS: "Ausführungsbereitschaft bestätigen",
};
const statusLabels = { OVERDUE: "Überfällig", DUE_TODAY: "Heute", DUE_SOON: "Demnächst", OPEN: "Offen" };

function formatDate(value: string | null) {
  if (!value) return "Keine Frist";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export function CoordinationTasksPanel() {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["coordination-tasks"],
    queryFn: () => getCoordinationTasks(),
    refetchInterval: 30_000,
  });
  const counts = {
    OVERDUE: tasks.filter((task) => task.status === "OVERDUE").length,
    DUE_TODAY: tasks.filter((task) => task.status === "DUE_TODAY").length,
    DUE_SOON: tasks.filter((task) => task.status === "DUE_SOON").length,
    OPEN: tasks.filter((task) => task.status === "OPEN").length,
  };
  return (
    <Card className="border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-lg"><ListTodo className="h-5 w-5 text-primary" />Meine Aufgaben</CardTitle>
        <Badge variant="outline">{tasks.length} offen</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {([
            ["OVERDUE", "Überfällig", counts.OVERDUE, <AlertTriangle className="h-4 w-4 text-red-500" />],
            ["DUE_TODAY", "Heute fällig", counts.DUE_TODAY, <Clock3 className="h-4 w-4 text-amber-500" />],
            ["DUE_SOON", "Demnächst", counts.DUE_SOON, <Clock3 className="h-4 w-4 text-blue-500" />],
            ["OPEN", "Offen", counts.OPEN, <CheckCircle2 className="h-4 w-4 text-emerald-500" />],
          ] as const).map(([key, label, count, icon]) => (
            <div key={key} className="rounded-lg border bg-background p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">{label}{icon}</div>
              <div className="mt-1 text-xl font-semibold">{count}</div>
            </div>
          ))}
        </div>
        {isLoading ? <p className="text-sm text-muted-foreground">Aufgaben werden geladen …</p> :
          tasks.length === 0 ? <p className="py-4 text-center text-sm text-muted-foreground">Keine offenen Aufgaben.</p> :
          <div className="space-y-2">
            {tasks.slice(0, 8).map((task) => (
              <Link key={task.id} href={task.targetUrl}>
                <div className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/40">
                  <Badge variant={task.status === "OVERDUE" ? "destructive" : "outline"}>{statusLabels[task.status]}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{task.serviceName}</p>
                    <p className="truncate text-xs text-muted-foreground">{taskLabels[task.taskType]} · {task.partnerName}</p>
                  </div>
                  <span className="hidden text-xs text-muted-foreground sm:block">{formatDate(task.dueAt)}</span>
                </div>
              </Link>
            ))}
          </div>}
      </CardContent>
    </Card>
  );
}