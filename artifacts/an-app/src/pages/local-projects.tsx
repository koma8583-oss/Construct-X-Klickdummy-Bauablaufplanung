/**
 * Lokale Projekte — NU-only page.
 * Route: /local-projects
 *
 * Shows the AN's own internal projects (nu_local_projects). AGs receive 403
 * from the backend. customerAlias is sensitive and must not be shared externally;
 * it is only shown within this AN-only UI.
 */
import { useState } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  useListNuLocalProjects,
  useCreateNuLocalProject,
  useUpdateNuLocalProject,
  getListNuLocalProjectsQueryKey,
  type NuLocalProject,
  type NuLocalProjectCreate,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  CheckCircle,
  Loader2,
  FolderOpen,
  AlertTriangle,
  RefreshCw,
  X,
  Archive,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";
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
import { DatePicker } from "@/components/date-picker";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  PLANNED: "Geplant",
  ACTIVE: "Aktiv",
  COMPLETED: "Abgeschlossen",
  CANCELLED: "Storniert",
};

const STATUS_STYLES: Record<string, string> = {
  PLANNED: "text-blue-600 bg-blue-500/10",
  ACTIVE: "text-emerald-600 bg-emerald-500/10",
  COMPLETED: "text-muted-foreground bg-muted/50",
  CANCELLED: "text-red-600 bg-red-500/10",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      }`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function fmtDate(s?: string | null): string {
  if (!s) return "–";
  try { return format(new Date(s), "dd.MM.yyyy", { locale: de }); } catch { return s; }
}

// ── Create / Edit Form ─────────────────────────────────────────────────────────

interface ProjectFormData {
  localProjectCode: string;
  displayName: string;
  customerAlias: string;
  startDate: string;
  endDate: string;
  status: string;
}

const EMPTY_FORM: ProjectFormData = {
  localProjectCode: "",
  displayName: "",
  customerAlias: "",
  startDate: "",
  endDate: "",
  status: "PLANNED",
};

function ProjectDialog({
  open,
  onClose,
  initial,
  onSave,
  isSaving,
  title,
}: {
  open: boolean;
  onClose: () => void;
  initial: ProjectFormData;
  onSave: (data: ProjectFormData) => void;
  isSaving: boolean;
  title: string;
}) {
  const [form, setForm] = useState<ProjectFormData>(initial);

  // Reset form when dialog opens with new initial values
  const handleOpen = (o: boolean) => {
    if (o) setForm(initial);
  };

  const set = (field: keyof ProjectFormData, value: string) =>
    setForm((f) => ({ ...f, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={(o) => { handleOpen(o); if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lp-code" className="text-xs">Projektnummer *</Label>
              <Input
                id="lp-code"
                value={form.localProjectCode}
                onChange={(e) => set("localProjectCode", e.target.value)}
                placeholder="z. B. LP-2026-001"
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lp-status" className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v)}>
                <SelectTrigger id="lp-status" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lp-name" className="text-xs">Bezeichnung *</Label>
            <Input
              id="lp-name"
              value={form.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              placeholder="Projektbezeichnung"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lp-alias" className="text-xs">
              Auftraggeber-Alias{" "}
              <span className="text-muted-foreground font-normal">(nur intern sichtbar)</span>
            </Label>
            <Input
              id="lp-alias"
              value={form.customerAlias}
              onChange={(e) => set("customerAlias", e.target.value)}
              placeholder="z. B. Kunde A"
              className="h-9"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lp-start" className="text-xs">Startdatum</Label>
              <DatePicker
                id="lp-start"
                value={form.startDate}
                onChange={(value) => set("startDate", value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lp-end" className="text-xs">Enddatum</Label>
              <DatePicker
                id="lp-end"
                value={form.endDate}
                onChange={(value) => set("endDate", value)}
                className="h-9"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
              <X className="w-4 h-4 mr-1.5" />
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(form)}
              disabled={isSaving || !form.localProjectCode.trim() || !form.displayName.trim()}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {isSaving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1.5" />}
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function LocalProjectsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  const [editProject, setEditProject] = useState<NuLocalProject | null>(null);

  const queryParams = statusFilter !== "ALL" ? { status: statusFilter as any } : undefined;
  const { data, isLoading, isError, refetch } = useListNuLocalProjects(queryParams);

  const createMutation = useCreateNuLocalProject();
  const updateMutation = useUpdateNuLocalProject();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListNuLocalProjectsQueryKey() });

  const handleCreate = async (form: ProjectFormData) => {
    const body: NuLocalProjectCreate = {
      localProjectCode: form.localProjectCode.trim(),
      displayName: form.displayName.trim(),
      ...(form.customerAlias.trim() && { customerAlias: form.customerAlias.trim() }),
      ...(form.startDate && { startDate: form.startDate }),
      ...(form.endDate && { endDate: form.endDate }),
      status: form.status as any,
    };
    try {
      await createMutation.mutateAsync({ data: body });
      setCreateOpen(false);
      invalidate();
      toast({ title: "Projekt angelegt" });
    } catch (err: any) {
      const msg = err?.message ?? "Fehler beim Anlegen";
      toast({ title: "Fehler", description: msg, variant: "destructive" });
    }
  };

  const handleEdit = async (form: ProjectFormData) => {
    if (!editProject) return;
    try {
      await updateMutation.mutateAsync({
        projectId: editProject.id,
        data: {
          displayName: form.displayName.trim() || undefined,
          ...(form.customerAlias !== undefined && { customerAlias: form.customerAlias }),
          ...(form.startDate && { startDate: form.startDate }),
          ...(form.endDate && { endDate: form.endDate }),
          status: form.status as any,
        },
      });
      setEditProject(null);
      invalidate();
      toast({ title: "Projekt aktualisiert" });
    } catch (err: any) {
      toast({ title: "Fehler", description: err?.message ?? "Fehler", variant: "destructive" });
    }
  };

  const handleDeactivate = async (p: NuLocalProject, newStatus: "COMPLETED" | "CANCELLED") => {
    const label = newStatus === "COMPLETED" ? "abschließen" : "stornieren";
    if (!confirm(`Projekt "${p.displayName}" ${label}?`)) return;
    try {
      await updateMutation.mutateAsync({
        projectId: p.id,
        data: { status: newStatus },
      });
      invalidate();
      toast({ title: `Projekt ${newStatus === "COMPLETED" ? "abgeschlossen" : "storniert"}` });
    } catch {
      toast({ title: "Fehler", variant: "destructive" });
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      {/* Privacy notice */}
      <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
        <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-blue-800 dark:text-blue-300 text-sm">
          Interne Projekte und Aufträge werden nur innerhalb Ihrer Organisation verwendet und nicht an Auftraggeber übertragen.
        </AlertDescription>
      </Alert>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Interne Projekte</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Interne Projekte Ihres Unternehmens — nicht für Auftraggeber sichtbar
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Neues Projekt
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-full sm:w-[180px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Alle Status</SelectItem>
            {Object.entries(STATUS_LABELS).map(([k, l]) => (
              <SelectItem key={k} value={k}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-4 py-20">
          <AlertTriangle className="w-10 h-10 text-destructive" />
          <p className="text-muted-foreground">Fehler beim Laden der Projekte</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Erneut versuchen
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 border border-dashed rounded-xl">
          <FolderOpen className="w-12 h-12 text-muted-foreground opacity-40" />
          <p className="font-medium text-muted-foreground">Keine Projekte vorhanden</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="w-4 h-4 mr-2" />
            Erstes Projekt anlegen
          </Button>
        </div>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-xs">Projektnr.</TableHead>
                    <TableHead className="text-xs">Bezeichnung</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Auftraggeber (intern)</TableHead>
                    <TableHead className="text-xs hidden sm:table-cell">Zeitraum</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs w-20 sm:w-[140px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((p) => (
                    <TableRow key={p.id} className="border-border hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {p.localProjectCode}
                      </TableCell>
                      <TableCell className="font-medium text-sm">{p.displayName}</TableCell>
                      <TableCell className="text-muted-foreground text-sm hidden sm:table-cell">
                        {p.customerAlias ?? "–"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap hidden sm:table-cell">
                        {p.startDate || p.endDate
                          ? `${fmtDate(p.startDate)} – ${fmtDate(p.endDate)}`
                          : "–"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Bearbeiten"
                            onClick={() => setEditProject(p)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {p.status === "ACTIVE" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-amber-600"
                              title="Abschließen"
                              onClick={() => handleDeactivate(p, "COMPLETED")}
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </Button>
                          )}
                          {(p.status === "PLANNED" || p.status === "ACTIVE") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                              title="Stornieren"
                              onClick={() => handleDeactivate(p, "CANCELLED")}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">{items.length} Projekte</p>

      {/* Create dialog */}
      <ProjectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initial={EMPTY_FORM}
        onSave={handleCreate}
        isSaving={createMutation.isPending}
        title="Neues lokales Projekt"
      />

      {/* Edit dialog */}
      {editProject && (
        <ProjectDialog
          open={!!editProject}
          onClose={() => setEditProject(null)}
          initial={{
            localProjectCode: editProject.localProjectCode,
            displayName: editProject.displayName,
            customerAlias: editProject.customerAlias ?? "",
            startDate: editProject.startDate ?? "",
            endDate: editProject.endDate ?? "",
            status: editProject.status,
          }}
          onSave={handleEdit}
          isSaving={updateMutation.isPending}
          title="Projekt bearbeiten"
        />
      )}
    </div>
  );
}
