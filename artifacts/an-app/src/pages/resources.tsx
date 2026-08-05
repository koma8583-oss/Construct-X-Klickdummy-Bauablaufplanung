/**
 * Ressourcenverwaltung — zwei Tabs:
 *   1. Ressourcentypen  (CRUD, Deaktivierung)
 *   2. Ressourcen       (CRUD mit Ressourcentyp-Dropdown)
 *
 * Route: /resources
 */
import { useState } from "react";
import {
  useListResources,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
  getListResourcesQueryKey,
  type Resource,
} from "@workspace/api-client-react";
import {
  useListResourceTypes,
  useCreateResourceType,
  useUpdateResourceType,
  useDeactivateResourceType,
  getResourceTypesQueryKey,
  type ResourceTypeRecord,
  type ResourceTypeCategory,
  type ResourceCapacityUnit,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Plus,
  Pencil,
  Archive,
  X,
  Check,
  HardHat,
  Tag,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Constants ─────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<ResourceTypeCategory, string> = {
  PERSONNEL: "Personal",
  CREW: "Kolonne",
  EQUIPMENT: "Gerät",
  MACHINE: "Maschine",
  OTHER: "Sonstige",
};

const CATEGORY_COLORS: Record<ResourceTypeCategory, string> = {
  PERSONNEL: "text-blue-600 bg-blue-500/10",
  CREW: "text-violet-600 bg-violet-500/10",
  EQUIPMENT: "text-amber-600 bg-amber-500/10",
  MACHINE: "text-orange-600 bg-orange-500/10",
  OTHER: "text-muted-foreground bg-muted/50",
};

const CAPACITY_UNIT_LABELS: Record<ResourceCapacityUnit, string> = {
  PERSONS: "Personen",
  UNITS: "Einheiten",
  HOURS_PER_DAY: "Std/Tag",
  PERCENT: "Prozent",
};

const LEGACY_TYPE_LABELS: Record<string, string> = {
  EMPLOYEE: "Mitarbeiter",
  CREW: "Kolonne",
  EQUIPMENT: "Gerät",
  MACHINE: "Maschine",
  OTHER: "Sonstige",
};

// ── Shared helpers ────────────────────────────────────────────────────────────

function CategoryBadge({ category }: { category: ResourceTypeCategory }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${CATEGORY_COLORS[category]}`}
    >
      {CATEGORY_LABELS[category]}
    </span>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-emerald-600 bg-emerald-500/10">
      Aktiv
    </span>
  ) : (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-muted-foreground bg-muted/50">
      Inaktiv
    </span>
  );
}

// ── ResourceTypes Tab ─────────────────────────────────────────────────────────

interface RtFormData {
  name: string;
  category: ResourceTypeCategory;
  qualification: string;
  capacityUnit: ResourceCapacityUnit | "";
  defaultDailyCapacity: string;
}

const EMPTY_RT_FORM: RtFormData = {
  name: "",
  category: "PERSONNEL",
  qualification: "",
  capacityUnit: "",
  defaultDailyCapacity: "",
};

function ResourceTypeDialog({
  open,
  onClose,
  initial,
  onSave,
  isSaving,
  title,
}: {
  open: boolean;
  onClose: () => void;
  initial: RtFormData;
  onSave: (d: RtFormData) => void;
  isSaving: boolean;
  title: string;
}) {
  const [form, setForm] = useState<RtFormData>(initial);
  const set = <K extends keyof RtFormData>(k: K, v: RtFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // reset when dialog opens
  const handleOpenChange = (o: boolean) => {
    if (o) setForm(initial);
    if (!o) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="rt-name" className="text-xs">
              Bezeichnung *
            </Label>
            <Input
              id="rt-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z. B. Facharbeiter Trockenbau"
              className="h-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rt-category" className="text-xs">
                Kategorie *
              </Label>
              <Select
                value={form.category}
                onValueChange={(v) => set("category", v as ResourceTypeCategory)}
              >
                <SelectTrigger id="rt-category" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as ResourceTypeCategory[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CATEGORY_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rt-unit" className="text-xs">
                Kapazitätseinheit
              </Label>
              <Select
                value={form.capacityUnit}
                onValueChange={(v) => set("capacityUnit", v as ResourceCapacityUnit | "")}
              >
                <SelectTrigger id="rt-unit" className="h-9">
                  <SelectValue placeholder="– keine –" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">– keine –</SelectItem>
                  {(Object.keys(CAPACITY_UNIT_LABELS) as ResourceCapacityUnit[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CAPACITY_UNIT_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rt-cap" className="text-xs">
              Standardkapazität pro Tag
            </Label>
            <Input
              id="rt-cap"
              type="number"
              min="0"
              step="0.5"
              value={form.defaultDailyCapacity}
              onChange={(e) => set("defaultDailyCapacity", e.target.value)}
              placeholder="z. B. 8"
              className="h-9"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rt-qual" className="text-xs">
              Qualifikation / Beschreibung
            </Label>
            <Input
              id="rt-qual"
              value={form.qualification}
              onChange={(e) => set("qualification", e.target.value)}
              placeholder="z. B. Trockenbauer mit Führerschein Kl. B"
              className="h-9"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
              <X className="w-4 h-4 mr-1.5" />
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(form)}
              disabled={isSaving || !form.name.trim()}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-1.5" />
              )}
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResourceTypesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<ResourceTypeRecord | null>(null);

  const { data, isLoading, isError } = useListResourceTypes(
    showInactive ? { includeInactive: true } : undefined,
  );
  const createMut = useCreateResourceType();
  const updateMut = useUpdateResourceType();
  const deactivateMut = useDeactivateResourceType();

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getResourceTypesQueryKey() });

  const handleCreate = async (form: RtFormData) => {
    try {
      await createMut.mutateAsync({
        name: form.name.trim(),
        category: form.category,
        ...(form.qualification.trim() && { qualification: form.qualification.trim() }),
        ...(form.capacityUnit && { capacityUnit: form.capacityUnit }),
        ...(form.defaultDailyCapacity && {
          defaultDailyCapacity: parseFloat(form.defaultDailyCapacity),
        }),
      });
      setCreateOpen(false);
      invalidate();
      toast({ title: "Ressourcentyp angelegt" });
    } catch (err: unknown) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    }
  };

  const handleEdit = async (form: RtFormData) => {
    if (!editItem) return;
    try {
      await updateMut.mutateAsync({
        id: editItem.id,
        data: {
          name: form.name.trim() || undefined,
          category: form.category,
          qualification: form.qualification.trim() || null,
          capacityUnit: (form.capacityUnit as ResourceCapacityUnit) || null,
          defaultDailyCapacity: form.defaultDailyCapacity
            ? parseFloat(form.defaultDailyCapacity)
            : null,
        },
      });
      setEditItem(null);
      invalidate();
      toast({ title: "Ressourcentyp aktualisiert" });
    } catch (err: unknown) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    }
  };

  const handleDeactivate = async (rt: ResourceTypeRecord) => {
    if (!confirm(`Ressourcentyp „${rt.name}" deaktivieren?`)) return;
    try {
      await deactivateMut.mutateAsync(rt.id);
      invalidate();
      toast({ title: "Ressourcentyp deaktiviert" });
    } catch {
      toast({ title: "Fehler", variant: "destructive" });
    }
  };

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-border"
            />
            Inaktive anzeigen
          </label>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white"
          size="sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          Neuer Ressourcentyp
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <p className="text-muted-foreground text-sm">Fehler beim Laden</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 border border-dashed rounded-xl">
          <Tag className="w-10 h-10 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground font-medium">Noch keine Ressourcentypen</p>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Ersten Typ anlegen
          </Button>
        </div>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-xs">Bezeichnung</TableHead>
                    <TableHead className="text-xs">Kategorie</TableHead>
                    <TableHead className="text-xs">Qualifikation</TableHead>
                    <TableHead className="text-xs">Einheit</TableHead>
                    <TableHead className="text-xs">Std/Tag</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((rt) => (
                    <TableRow
                      key={rt.id}
                      className="border-border hover:bg-muted/30 transition-colors"
                    >
                      <TableCell className="font-medium text-sm">{rt.name}</TableCell>
                      <TableCell>
                        <CategoryBadge category={rt.category} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {rt.qualification ?? "–"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {rt.capacityUnit
                          ? CAPACITY_UNIT_LABELS[rt.capacityUnit]
                          : "–"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {rt.defaultDailyCapacity ?? "–"}
                      </TableCell>
                      <TableCell>
                        <ActiveBadge active={rt.active} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Bearbeiten"
                            onClick={() => setEditItem(rt)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          {rt.active && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-amber-600"
                              title="Deaktivieren"
                              onClick={() => handleDeactivate(rt)}
                            >
                              <Archive className="w-3.5 h-3.5" />
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

      <ResourceTypeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initial={EMPTY_RT_FORM}
        onSave={handleCreate}
        isSaving={createMut.isPending}
        title="Neuer Ressourcentyp"
      />

      {editItem && (
        <ResourceTypeDialog
          open
          onClose={() => setEditItem(null)}
          initial={{
            name: editItem.name,
            category: editItem.category,
            qualification: editItem.qualification ?? "",
            capacityUnit: editItem.capacityUnit ?? "",
            defaultDailyCapacity: editItem.defaultDailyCapacity?.toString() ?? "",
          }}
          onSave={handleEdit}
          isSaving={updateMut.isPending}
          title="Ressourcentyp bearbeiten"
        />
      )}
    </div>
  );
}

// ── Resources Tab ─────────────────────────────────────────────────────────────

interface ResFormData {
  name: string;
  type: string;
  resourceTypeId: string;
  qualification: string;
  dailyCapacityHours: string;
  color: string;
}

const EMPTY_RES_FORM: ResFormData = {
  name: "",
  type: "EMPLOYEE",
  resourceTypeId: "",
  qualification: "",
  dailyCapacityHours: "8",
  color: "#10b981",
};

function ResourceDialog({
  open,
  onClose,
  initial,
  onSave,
  isSaving,
  title,
  resourceTypes,
}: {
  open: boolean;
  onClose: () => void;
  initial: ResFormData;
  onSave: (d: ResFormData) => void;
  isSaving: boolean;
  title: string;
  resourceTypes: ResourceTypeRecord[];
}) {
  const [form, setForm] = useState<ResFormData>(initial);
  const set = <K extends keyof ResFormData>(k: K, v: ResFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleOpenChange = (o: boolean) => {
    if (o) setForm(initial);
    if (!o) onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="res-name" className="text-xs">
              Name *
            </Label>
            <Input
              id="res-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="z. B. Max Mustermann"
              className="h-9"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-type" className="text-xs">
                Typ
              </Label>
              <Select value={form.type} onValueChange={(v) => set("type", v)}>
                <SelectTrigger id="res-type" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(LEGACY_TYPE_LABELS).map(([k, l]) => (
                    <SelectItem key={k} value={k}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="res-rt" className="text-xs">
                Ressourcentyp
              </Label>
              <Select
                value={form.resourceTypeId}
                onValueChange={(v) => set("resourceTypeId", v)}
              >
                <SelectTrigger id="res-rt" className="h-9">
                  <SelectValue placeholder="– keiner –" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">– keiner –</SelectItem>
                  {resourceTypes.map((rt) => (
                    <SelectItem key={rt.id} value={rt.id}>
                      {rt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-cap" className="text-xs">
                Tageskapazität (h)
              </Label>
              <Input
                id="res-cap"
                type="number"
                min="0"
                step="0.5"
                value={form.dailyCapacityHours}
                onChange={(e) => set("dailyCapacityHours", e.target.value)}
                className="h-9"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="res-color" className="text-xs">
                Farbe
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="res-color"
                  type="color"
                  value={form.color}
                  onChange={(e) => set("color", e.target.value)}
                  className="h-9 w-12 p-1"
                />
                <span className="text-xs text-muted-foreground">{form.color}</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="res-qual" className="text-xs">
              Qualifikation
            </Label>
            <Input
              id="res-qual"
              value={form.qualification}
              onChange={(e) => set("qualification", e.target.value)}
              placeholder="z. B. Trockenbauer"
              className="h-9"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
              <X className="w-4 h-4 mr-1.5" />
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(form)}
              disabled={isSaving || !form.name.trim()}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-1.5" />
              )}
              Speichern
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResourcesTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<Resource | null>(null);

  const { data: resources, isLoading, isError } = useListResources();
  const { data: rtData } = useListResourceTypes();
  const resourceTypes = rtData?.items ?? [];

  const createMut = useCreateResource();
  const updateMut = useUpdateResource();
  const deleteMut = useDeleteResource();

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getListResourcesQueryKey() });

  const handleCreate = async (form: ResFormData) => {
    try {
      await createMut.mutateAsync({
        data: {
          type: form.type as Resource["type"],
          name: form.name.trim(),
          ...(form.qualification.trim() && { qualification: form.qualification.trim() }),
          ...(form.dailyCapacityHours && {
            dailyCapacityHours: parseFloat(form.dailyCapacityHours),
          }),
          ...(form.color && { color: form.color }),
          ...(form.resourceTypeId && { resourceTypeId: form.resourceTypeId }),
        },
      });
      setCreateOpen(false);
      invalidate();
      toast({ title: "Ressource angelegt" });
    } catch (err: unknown) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    }
  };

  const handleEdit = async (form: ResFormData) => {
    if (!editItem) return;
    try {
      await updateMut.mutateAsync({
        resourceId: editItem.id,
        data: {
          name: form.name.trim() || undefined,
          type: form.type as Resource["type"],
          qualification: form.qualification.trim() || undefined,
          dailyCapacityHours: form.dailyCapacityHours
            ? parseFloat(form.dailyCapacityHours)
            : undefined,
          color: form.color || undefined,
          resourceTypeId: form.resourceTypeId || undefined,
        },
      });
      setEditItem(null);
      invalidate();
      toast({ title: "Ressource aktualisiert" });
    } catch (err: unknown) {
      toast({
        title: "Fehler",
        description: err instanceof Error ? err.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (r: Resource) => {
    if (!confirm(`Ressource „${r.name}" deaktivieren?`)) return;
    try {
      await deleteMut.mutateAsync({ resourceId: r.id });
      invalidate();
      toast({ title: "Ressource deaktiviert" });
    } catch {
      toast({ title: "Fehler", variant: "destructive" });
    }
  };

  const getResourceTypeName = (id: string | null | undefined) =>
    id ? (resourceTypes.find((rt) => rt.id === id)?.name ?? "–") : "–";

  const items = Array.isArray(resources) ? resources : [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white"
          size="sm"
        >
          <Plus className="w-4 h-4 mr-2" />
          Neue Ressource
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <p className="text-muted-foreground text-sm">Fehler beim Laden</p>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 border border-dashed rounded-xl">
          <HardHat className="w-10 h-10 text-muted-foreground opacity-40" />
          <p className="text-muted-foreground font-medium">Noch keine Ressourcen</p>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Erste Ressource anlegen
          </Button>
        </div>
      ) : (
        <Card className="bg-card border-border">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border">
                    <TableHead className="text-xs">Name</TableHead>
                    <TableHead className="text-xs">Typ</TableHead>
                    <TableHead className="text-xs">Ressourcentyp</TableHead>
                    <TableHead className="text-xs">Qualifikation</TableHead>
                    <TableHead className="text-xs">Std/Tag</TableHead>
                    <TableHead className="text-xs">Farbe</TableHead>
                    <TableHead className="text-xs w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((r) => (
                    <TableRow
                      key={r.id}
                      className="border-border hover:bg-muted/30 transition-colors"
                    >
                      <TableCell className="font-medium text-sm">{r.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {LEGACY_TYPE_LABELS[r.type] ?? r.type}
                      </TableCell>
                      <TableCell className="text-sm">
                        {getResourceTypeName((r as Resource & { resourceTypeId?: string }).resourceTypeId)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {r.qualification ?? "–"}
                      </TableCell>
                      <TableCell className="text-sm">{r.dailyCapacityHours ?? "–"}</TableCell>
                      <TableCell>
                        {r.color ? (
                          <div
                            className="w-5 h-5 rounded border border-border"
                            style={{ backgroundColor: r.color }}
                          />
                        ) : (
                          <span className="text-muted-foreground text-sm">–</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            title="Bearbeiten"
                            onClick={() => setEditItem(r)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-amber-600"
                            title="Deaktivieren"
                            onClick={() => handleDelete(r)}
                          >
                            <Archive className="w-3.5 h-3.5" />
                          </Button>
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

      <ResourceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        initial={EMPTY_RES_FORM}
        onSave={handleCreate}
        isSaving={createMut.isPending}
        title="Neue Ressource anlegen"
        resourceTypes={resourceTypes}
      />

      {editItem && (
        <ResourceDialog
          open
          onClose={() => setEditItem(null)}
          initial={{
            name: editItem.name,
            type: editItem.type,
            resourceTypeId: (editItem as Resource & { resourceTypeId?: string }).resourceTypeId ?? "",
            qualification: editItem.qualification ?? "",
            dailyCapacityHours: editItem.dailyCapacityHours?.toString() ?? "",
            color: editItem.color ?? "#10b981",
          }}
          onSave={handleEdit}
          isSaving={updateMut.isPending}
          title="Ressource bearbeiten"
          resourceTypes={resourceTypes}
        />
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ResourcesPage() {
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl font-bold">Ressourcen</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Verwalten Sie Ressourcentypen und konkrete Ressourcen Ihrer Organisation.
        </p>
      </div>

      <Tabs defaultValue="types">
        <TabsList className="bg-sidebar-accent">
          <TabsTrigger value="types" className="data-[state=active]:bg-card">
            <Tag className="w-3.5 h-3.5 mr-1.5" />
            Ressourcentypen
          </TabsTrigger>
          <TabsTrigger value="resources" className="data-[state=active]:bg-card">
            <HardHat className="w-3.5 h-3.5 mr-1.5" />
            Ressourcen
          </TabsTrigger>
        </TabsList>

        <TabsContent value="types" className="mt-4">
          <ResourceTypesTab />
        </TabsContent>

        <TabsContent value="resources" className="mt-4">
          <ResourcesTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
