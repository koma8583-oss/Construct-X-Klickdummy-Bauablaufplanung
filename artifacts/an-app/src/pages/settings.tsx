import { useState } from "react";
import { useTranslation } from "react-i18next";
import { 
  useGetMyProfile, 
  useUpdateMyProfile, 
  useGetMyOrganizations,
  useListOrganizationMembers,
  useAddOrganizationMember,
  useRemoveOrganizationMember,
  useListWebhooks,
  useCreateWebhook,
  useUpdateWebhook,
  useDeleteWebhook,
  useListWebhookEvents,
  getGetMyProfileQueryKey,
  getListOrganizationMembersQueryKey,
  getListWebhooksQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, CheckCircle2, XCircle } from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { format } from "date-fns";

export default function Settings() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  
  // Profile
  const { data: profile } = useGetMyProfile();
  const updateProfile = useUpdateMyProfile();
  const [name, setName] = useState(profile?.name || "");
  const [lang, setLang] = useState<string>(profile?.preferredLanguage || "de");
  
  // Org
  const { data: orgs } = useGetMyOrganizations();
  const myOrgId = user?.orgId;
  const { data: members } = useListOrganizationMembers(myOrgId || "", { query: { enabled: !!myOrgId, queryKey: getListOrganizationMembersQueryKey(myOrgId || "") }});
  const addMember = useAddOrganizationMember();
  const removeMember = useRemoveOrganizationMember();
  const [newMemberEmail, setNewMemberEmail] = useState("");

  // Webhooks
  const { data: webhooks } = useListWebhooks({ query: { enabled: !!myOrgId, queryKey: getListWebhooksQueryKey() }});
  const createWebhook = useCreateWebhook();
  const updateWebhook = useUpdateWebhook();
  const deleteWebhook = useDeleteWebhook();
  const { data: events } = useListWebhookEvents();
  
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const handleProfileSave = async () => {
    await updateProfile.mutateAsync({ data: { name, preferredLanguage: lang as any } });
    i18n.changeLanguage(lang);
    queryClient.invalidateQueries({ queryKey: getGetMyProfileQueryKey() });
  };

  const handleAddMember = async () => {
    if (!myOrgId || !newMemberEmail) return;
    await addMember.mutateAsync({ orgId: myOrgId, data: { email: newMemberEmail, role: "MEMBER" }});
    setNewMemberEmail("");
    queryClient.invalidateQueries({ queryKey: getListOrganizationMembersQueryKey(myOrgId) });
  };

  const handleCreateWebhook = async () => {
    await createWebhook.mutateAsync({ 
      data: { 
        url: webhookUrl, 
        secret: webhookSecret || undefined,
        events: ["delegation.created", "delegation.cancelled", "response.accepted", "response.rejected"] 
      }
    });
    setWebhookUrl("");
    setWebhookSecret("");
    queryClient.invalidateQueries({ queryKey: getListWebhooksQueryKey() });
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-foreground">{t("settings.title")}</h1>

      <Tabs defaultValue="profile">
        <TabsList className="bg-sidebar-accent border-b border-border rounded-none w-full justify-start">
          <TabsTrigger value="profile" className="data-[state=active]:bg-card">{t("settings.profile")}</TabsTrigger>
          <TabsTrigger value="team" className="data-[state=active]:bg-card">{t("settings.team")}</TabsTrigger>
          <TabsTrigger value="webhooks" className="data-[state=active]:bg-card">{t("settings.webhooks")}</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Persönliche Daten</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 max-w-md">
              <div className="space-y-2">
                <label className="text-sm font-medium">Name</label>
                <Input value={name || profile?.name || ""} onChange={e => setName(e.target.value)} className="bg-background" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input value={profile?.email || ""} disabled className="bg-muted text-muted-foreground" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Sprache</label>
                <Select value={lang || profile?.preferredLanguage || "de"} onValueChange={setLang}>
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="de">Deutsch</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleProfileSave} disabled={updateProfile.isPending} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                {updateProfile.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {t("common.save")}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="mt-6 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Team-Mitglieder</CardTitle>
              <CardDescription>Verwalten Sie die Benutzer Ihrer Organisation ({user?.orgName}).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex gap-2 max-w-md">
                <Input 
                  placeholder="E-Mail des neuen Mitglieds" 
                  value={newMemberEmail} 
                  onChange={e => setNewMemberEmail(e.target.value)}
                  className="bg-background"
                />
                <Button onClick={handleAddMember} disabled={addMember.isPending || !newMemberEmail} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                  {addMember.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </Button>
              </div>

              <div className="rounded border border-border">
                {members?.map(m => (
                  <div key={m.userId} className="flex justify-between items-center p-3 border-b border-border last:border-0 hover:bg-sidebar-accent/50 transition-colors">
                    <div>
                      <div className="font-medium text-foreground">{m.name}</div>
                      <div className="text-sm text-muted-foreground">{m.email}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-xs uppercase bg-sidebar-accent px-2 py-1 rounded text-muted-foreground">{m.role}</span>
                      {m.userId !== user?.id && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                          onClick={async () => {
                            if(confirm(t("common.delete") + "?") && myOrgId) {
                              await removeMember.mutateAsync({ orgId: myOrgId, userId: m.userId });
                              queryClient.invalidateQueries({ queryKey: getListOrganizationMembersQueryKey(myOrgId) });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks" className="mt-6 space-y-6">
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Webhooks</CardTitle>
              <CardDescription>Empfangen Sie Benachrichtigungen an Ihre eigenen Systeme.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Endpoint URL</label>
                  <Input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)} placeholder="https://api.example.com/webhook" className="bg-background" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Secret (Optional)</label>
                  <Input value={webhookSecret} onChange={e => setWebhookSecret(e.target.value)} type="password" placeholder="Webhook Secret" className="bg-background" />
                </div>
              </div>
              <Button onClick={handleCreateWebhook} disabled={!webhookUrl || createWebhook.isPending} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                <Plus className="w-4 h-4 mr-2" /> Webhook hinzufügen
              </Button>

              <div className="space-y-4 mt-8">
                <h3 className="font-medium">Aktive Webhooks</h3>
                {webhooks?.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Webhooks konfiguriert.</p>
                ) : (
                  webhooks?.map(wh => (
                    <div key={wh.id} className="p-4 rounded border border-border bg-sidebar-accent/30 flex justify-between items-start">
                      <div>
                        <div className="font-mono text-sm text-foreground break-all">{wh.url}</div>
                        <div className="text-xs text-muted-foreground mt-2 flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${wh.active ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
                          {wh.active ? 'Aktiv' : 'Inaktiv'}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={async () => {
                            await updateWebhook.mutateAsync({ webhookId: wh.id, data: { active: !wh.active }});
                            queryClient.invalidateQueries({ queryKey: getListWebhooksQueryKey() });
                          }}
                        >
                          {wh.active ? 'Deaktivieren' : 'Aktivieren'}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon"
                          className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                          onClick={async () => {
                            if(confirm("Löschen?")) {
                              await deleteWebhook.mutateAsync({ webhookId: wh.id });
                              queryClient.invalidateQueries({ queryKey: getListWebhooksQueryKey() });
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-4 mt-8">
                <h3 className="font-medium">Letzte Ereignisse (Log)</h3>
                <div className="rounded border border-border bg-sidebar-accent/30 max-h-64 overflow-y-auto">
                  {events?.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground text-center">Keine Ereignisse.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-sidebar-accent sticky top-0 border-b border-border">
                        <tr>
                          <th className="text-left p-2 font-medium">Zeit</th>
                          <th className="text-left p-2 font-medium">Event</th>
                          <th className="text-left p-2 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events?.slice(0, 20).map(e => (
                          <tr key={e.id} className="border-b border-border last:border-0">
                            <td className="p-2 text-muted-foreground">{format(new Date(e.createdAt), 'dd.MM. HH:mm')}</td>
                            <td className="p-2 font-mono text-xs">{e.event}</td>
                            <td className="p-2">
                              {e.status === 'DELIVERED' ? (
                                <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> OK</span>
                              ) : e.status === 'FAILED' ? (
                                <span className="text-red-500 flex items-center gap-1"><XCircle className="w-3 h-3" /> Fehler</span>
                              ) : (
                                <span className="text-amber-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Pending</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
