import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { 
  useListResources, 
  useCreateResource, 
  useUpdateResource, 
  useDeleteResource,
  getListResourcesQueryKey,
  ResourceType,
  Resource
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Plus, Pencil, Trash2, X, Check } from "lucide-react";

export default function Resources() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ResourceType>("EMPLOYEE");

  const { data: resources, isLoading } = useListResources({ type: activeTab });
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Resource>>({});
  
  const [isAdding, setIsAdding] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", qualification: "", dailyCapacityHours: 8, color: "#10b981" });

  const handleEdit = (r: Resource) => {
    setEditingId(r.id);
    setEditForm({ ...r });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    await updateResource.mutateAsync({
      resourceId: editingId,
      data: {
        name: editForm.name,
        qualification: editForm.qualification,
        dailyCapacityHours: editForm.dailyCapacityHours,
        color: editForm.color,
      }
    });
    setEditingId(null);
    queryClient.invalidateQueries({ queryKey: getListResourcesQueryKey() });
  };

  const saveAdd = async () => {
    await createResource.mutateAsync({
      data: {
        type: activeTab,
        name: addForm.name,
        qualification: addForm.qualification,
        dailyCapacityHours: addForm.dailyCapacityHours,
        color: addForm.color
      }
    });
    setIsAdding(false);
    setAddForm({ name: "", qualification: "", dailyCapacityHours: 8, color: "#10b981" });
    queryClient.invalidateQueries({ queryKey: getListResourcesQueryKey() });
  };

  const handleDelete = async (id: string) => {
    if (confirm(t("common.delete") + "?")) {
      await deleteResource.mutateAsync({ resourceId: id });
      queryClient.invalidateQueries({ queryKey: getListResourcesQueryKey() });
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-foreground">{t("resources.title")}</h1>
        <Button onClick={() => setIsAdding(true)} className="bg-emerald-500 hover:bg-emerald-600 text-white">
          <Plus className="w-4 h-4 mr-2" />
          {t("common.add")}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ResourceType)}>
        <TabsList className="bg-sidebar-accent w-full justify-start rounded-b-none border-b border-border">
          <TabsTrigger value="EMPLOYEE" className="data-[state=active]:bg-card">{t("resources.tabs.EMPLOYEE")}</TabsTrigger>
          <TabsTrigger value="EQUIPMENT" className="data-[state=active]:bg-card">{t("resources.tabs.EQUIPMENT")}</TabsTrigger>
          <TabsTrigger value="MACHINE" className="data-[state=active]:bg-card">{t("resources.tabs.MACHINE")}</TabsTrigger>
          <TabsTrigger value="OTHER" className="data-[state=active]:bg-card">{t("resources.tabs.OTHER")}</TabsTrigger>
        </TabsList>
        
        <Card className="bg-card border-border border-t-0 rounded-t-none">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex justify-center p-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead>{t("resources.name")}</TableHead>
                    <TableHead>{t("resources.qualification")}</TableHead>
                    <TableHead>{t("resources.capacity")}</TableHead>
                    <TableHead>{t("resources.color")}</TableHead>
                    <TableHead className="text-right w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isAdding && (
                    <TableRow className="border-border">
                      <TableCell>
                        <Input value={addForm.name} onChange={e => setAddForm({...addForm, name: e.target.value})} className="h-8 bg-background" placeholder={t("resources.name")} />
                      </TableCell>
                      <TableCell>
                        <Input value={addForm.qualification} onChange={e => setAddForm({...addForm, qualification: e.target.value})} className="h-8 bg-background" placeholder={t("resources.qualification")} />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={addForm.dailyCapacityHours} onChange={e => setAddForm({...addForm, dailyCapacityHours: Number(e.target.value)})} className="h-8 bg-background w-20" />
                      </TableCell>
                      <TableCell>
                        <Input type="color" value={addForm.color} onChange={e => setAddForm({...addForm, color: e.target.value})} className="h-8 w-12 p-1 bg-background" />
                      </TableCell>
                      <TableCell className="text-right flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-500" onClick={saveAdd}>
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={() => setIsAdding(false)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )}

                  {!resources || resources.length === 0 ? (
                    !isAdding && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                          Keine Ressourcen gefunden.
                        </TableCell>
                      </TableRow>
                    )
                  ) : (
                    resources.map(r => (
                      <TableRow key={r.id} className="border-border hover:bg-sidebar-accent/50">
                        {editingId === r.id ? (
                          <>
                            <TableCell>
                              <Input value={editForm.name || ""} onChange={e => setEditForm({...editForm, name: e.target.value})} className="h-8 bg-background" />
                            </TableCell>
                            <TableCell>
                              <Input value={editForm.qualification || ""} onChange={e => setEditForm({...editForm, qualification: e.target.value})} className="h-8 bg-background" />
                            </TableCell>
                            <TableCell>
                              <Input type="number" value={editForm.dailyCapacityHours || 0} onChange={e => setEditForm({...editForm, dailyCapacityHours: Number(e.target.value)})} className="h-8 bg-background w-20" />
                            </TableCell>
                            <TableCell>
                              <Input type="color" value={editForm.color || "#10b981"} onChange={e => setEditForm({...editForm, color: e.target.value})} className="h-8 w-12 p-1 bg-background" />
                            </TableCell>
                            <TableCell className="text-right flex gap-1 justify-end">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-500" onClick={saveEdit}>
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={cancelEdit}>
                                <X className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </>
                        ) : (
                          <>
                            <TableCell className="font-medium text-foreground">{r.name}</TableCell>
                            <TableCell className="text-muted-foreground">{r.qualification}</TableCell>
                            <TableCell>{r.dailyCapacityHours}</TableCell>
                            <TableCell>
                              <div className="w-6 h-6 rounded border border-border" style={{ backgroundColor: r.color || 'transparent' }} />
                            </TableCell>
                            <TableCell className="text-right flex gap-1 justify-end opacity-0 hover:opacity-100 focus-within:opacity-100 group-hover:opacity-100">
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => handleEdit(r)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500 hover:bg-red-500/10 hover:text-red-600" onClick={() => handleDelete(r.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
