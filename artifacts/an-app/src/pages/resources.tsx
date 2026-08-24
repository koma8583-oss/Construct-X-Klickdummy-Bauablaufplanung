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
  DTC_CLASSES,
  DTC_CLASS_LABELS,
  DTC_TO_CATEGORY,
  CATEGORY_TO_DTC,
  type DtcClassKey,
  type ResourceTypeRecord,
  type ResourceTypeCategory,
  type ResourceCapacityUnit,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const CAPACITY_UNIT_LABELS: Record<NonNullable<ResourceCapacityUnit>, string> = {
  PERSONS: "Personen",
  UNITS: "Einheiten",
  HOURS_PER_DAY: "Std/Tag",
  PERCENT: "Prozent",
};

/** DTC class dropdown options (friendly label → key → URI). */
const DTC_CLASS_KEYS = Object.keys(DTC_CLASS_LABELS) as DtcClassKey[];

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
  /** DTC class key (maps to the full URI) */
  dtcClassKey: DtcClassKey | "";
  /** Short internal code e.g. "LAB-DRYWALL" */
  code: string;
  capacityUnit: ResourceCapacityUnit | "";
}

const EMPTY_RT_FORM: RtFormData = {
  name: "",
  dtcClassKey: "WORKER",
  code: "",
  capacityUnit: "",
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

          <div className="space-y-1.5">
            <Label htmlFor="rt-dtc" className="text-xs">
              DTC-Klasse (Ressourcenart) *
            </Label>
            <Select
              value={form.dtcClassKey || "__NONE__"}
              onValueChange={(v) => set("dtcClassKey", v === "__NONE__" ? "" : v as DtcClassKey)}
            >
              <SelectTrigger id="rt-dtc" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__NONE__">Keine automatische DTC-Zuordnung</SelectItem>
                {DTC_CLASS_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {DTC_CLASS_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Basiert auf DTC-Ontologie v2 (TU München)
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rt-code" className="text-xs">
                Interner Code
              </Label>
              <Input
                id="rt-code"
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="z. B. LAB-DRYWALL"
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rt-unit" className="text-xs">
                Kapazitätseinheit
              </Label>
              <Select
                value={form.capacityUnit || "__NONE__"}
                onValueChange={(v) => set("capacityUnit", v === "__NONE__" ? "" : v as NonNullable<ResourceCapacityUnit>)}
              >
                <SelectTrigger id="rt-unit" className="h-9">
                  <SelectValue placeholder="– keine –" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__NONE__">– keine –</SelectItem>
                  {(Object.keys(CAPACITY_UNIT_LABELS) as NonNullable<ResourceCapacityUnit>[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {CAPACITY_UNIT_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                disabled={isSaving || !form.name.trim() || !form.dtcClassKey}
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
      const dtcClassKey = form.dtcClassKey || null;
      await createMut.mutateAsync({
        name: form.name.trim(),
        category: dtcClassKey ? DTC_TO_CATEGORY[dtcClassKey] : "OTHER",
        ...(dtcClassKey && { dtcClass: DTC_CLASSES[dtcClassKey] }),
        ...(form.code.trim() && { code: form.code.trim() }),
        ...(form.capacityUnit && { capacityUnit: form.capacityUnit }),
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
      const dtcClassKey = form.dtcClassKey || null;
      await updateMut.mutateAsync({
        id: editItem.id,
        data: {
          name: form.name.trim() || undefined,
          category: dtcClassKey ? DTC_TO_CATEGORY[dtcClassKey] : "OTHER",
          dtcClass: dtcClassKey ? DTC_CLASSES[dtcClassKey] : null,
          code: form.code.trim() || null,
          capacityUnit: (form.capacityUnit as ResourceCapacityUnit) || null,
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
        <Card className="bg-card border-border p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((rt) => (
              <article
                key={rt.id}
                className="flex min-w-0 flex-col rounded-xl border border-border bg-background/30 p-4 transition-colors hover:border-primary/50 hover:bg-muted/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold" title={rt.name}>{rt.name}</h3>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{rt.code ?? "Ohne Code"}</p>
                  </div>
                  <ActiveBadge active={rt.active} />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <CategoryBadge category={rt.category} />
                  <span className="text-xs text-muted-foreground">
                    {rt.capacityUnit ? CAPACITY_UNIT_LABELS[rt.capacityUnit] : "Keine Einheit"}
                  </span>
                </div>
                <div className="mt-auto flex justify-end gap-1 pt-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title="Bearbeiten"
                    onClick={() => setEditItem(rt)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {rt.active && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-amber-600"
                      title="Deaktivieren"
                      onClick={() => handleDeactivate(rt)}
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
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
            dtcClassKey: editItem.dtcClass
              ? (Object.entries(DTC_CLASSES).find(([, uri]) => uri === editItem.dtcClass)?.[0] as DtcClassKey ?? CATEGORY_TO_DTC[editItem.category])
              : CATEGORY_TO_DTC[editItem.category] ?? "",
            code: editItem.code ?? "",
            capacityUnit: editItem.capacityUnit ?? "",
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
  /** ResourceType ID — required for DTC compliance; type is derived from it */
  resourceTypeId: string;
  /** Capacity in units defined by the ResourceType */
  capacity: string;
  color: string;
}

const EMPTY_RES_FORM: ResFormData = {
  name: "",
  resourceTypeId: "",
  capacity: "",
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
  const selectedType = resourceTypes.find((rt) => rt.id === form.resourceTypeId);
  const capacityUnitLabel = selectedType?.capacityUnit
    ? CAPACITY_UNIT_LABELS[selectedType.capacityUnit]
    : "Einheiten";

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

          <div className="space-y-1.5">
            <Label htmlFor="res-rt" className="text-xs">
              Ressourcentyp *
            </Label>
            <Select
              value={form.resourceTypeId}
              onValueChange={(v) => set("resourceTypeId", v)}
            >
              <SelectTrigger id="res-rt" className="h-9">
                <SelectValue placeholder="Typ auswählen …" />
              </SelectTrigger>
              <SelectContent>
                {resourceTypes.length === 0 ? (
                   <SelectItem value="__NONE__" disabled>
                    Keine Ressourcentypen vorhanden
                  </SelectItem>
                ) : (
                  resourceTypes.map((rt) => (
                    <SelectItem key={rt.id} value={rt.id}>
                      {rt.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {resourceTypes.length === 0 && (
              <p className="text-[10px] text-amber-600">
                Bitte zuerst einen Ressourcentyp anlegen.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="res-cap" className="text-xs">
                 Kapazität
              </Label>
              <Input
                id="res-cap"
                type="number"
                min="0.01"
                step="0.01"
                value={form.capacity}
                onChange={(e) => set("capacity", e.target.value)}
                placeholder="z. B. 1"
                className="h-9"
              />
              <p className="text-[10px] text-muted-foreground">
                {capacityUnitLabel} — planbare Kapazität des ausgewählten Ressourcentyps.
              </p>
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

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
              <X className="w-4 h-4 mr-1.5" />
              Abbrechen
            </Button>
            <Button
              size="sm"
              onClick={() => onSave(form)}
              disabled={
                isSaving ||
                !form.name.trim() ||
                !form.resourceTypeId ||
                !form.capacity ||
                Number(form.capacity) <= 0
              }
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

  /** Derive a type string from a resource type's category. Cast needed because
   *  the generated OpenAPI enum predates CREW/OTHER support on the backend. */
  const deriveType = (rtId: string): string => {
    const rt = resourceTypes.find((r) => r.id === rtId);
    const catMap: Record<string, string> = {
      PERSONNEL: "EMPLOYEE",
      CREW: "CREW",
      EQUIPMENT: "EQUIPMENT",
      MACHINE: "MACHINE",
      OTHER: "OTHER",
    };
    return rt ? (catMap[rt.category] ?? "EMPLOYEE") : "EMPLOYEE";
  };

  const handleCreate = async (form: ResFormData) => {
    try {
      await createMut.mutateAsync({
        data: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: deriveType(form.resourceTypeId) as any,
          name: form.name.trim(),
          ...(form.color && { color: form.color }),
          resourceTypeId: form.resourceTypeId,
          ...(form.capacity && { capacity: parseFloat(form.capacity) }),
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
          color: form.color || undefined,
          resourceTypeId: form.resourceTypeId || undefined,
          ...(form.capacity && { capacity: parseFloat(form.capacity) }),
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
        <Card className="bg-card border-border p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((r) => (
              <article
                key={r.id}
                className="flex min-w-0 flex-col rounded-xl border border-border bg-background/30 p-4 transition-colors hover:border-primary/50 hover:bg-muted/20"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold" title={r.name}>{r.name}</h3>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {getResourceTypeName((r as Resource & { resourceTypeId?: string }).resourceTypeId)}
                    </p>
                  </div>
                  {r.color ? (
                    <div
                      className="h-7 w-7 shrink-0 rounded-md border border-border"
                      style={{ backgroundColor: r.color }}
                      title={`Farbe ${r.color}`}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Keine Farbe</span>
                  )}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 border-y border-border/70 py-3 text-sm">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Kapazität</p>
                    <p className="mt-1">{(r as Resource & { capacity?: number }).capacity ?? "–"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Status</p>
                    <p className="mt-1">{r.active ? "Aktiv" : "Inaktiv"}</p>
                  </div>
                </div>
                <div className="mt-auto flex justify-end gap-1 pt-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    title="Bearbeiten"
                    onClick={() => setEditItem(r)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-amber-600"
                    title="Deaktivieren"
                    onClick={() => handleDelete(r)}
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </article>
            ))}
          </div>
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
            resourceTypeId: (editItem as Resource & { resourceTypeId?: string }).resourceTypeId ?? "",
            capacity: (editItem as Resource & { capacity?: number }).capacity?.toString() ?? "",
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
