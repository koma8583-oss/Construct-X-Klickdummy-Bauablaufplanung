import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  useGetMyProfile,
  useUpdateMyProfile,
  useGetMyOrganizations,
  useUpdateOrganization,
  useListOrganizationMembers,
  useAddOrganizationMember,
  useRemoveOrganizationMember,
  useListWebhooks,
  useCreateWebhook,
  useDeleteWebhook,
  useListWebhookEvents,
  getGetMyOrganizationsQueryKey,
  getListOrganizationMembersQueryKey,
  getListWebhooksQueryKey,
  getListWebhookEventsQueryKey
} from '@workspace/api-client-react';
import { useAuth } from '@/contexts/auth-context';
import { useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Webhook, Users, UserCircle, Globe } from 'lucide-react';
import { format } from 'date-fns';

export default function Settings() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  
  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage your account settings, team members, and integrations.
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="bg-card border-border/50 border">
          <TabsTrigger value="profile" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <UserCircle className="w-4 h-4 mr-2" />
            {t('settings.profile')}
          </TabsTrigger>
          <TabsTrigger value="organisation" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Globe className="w-4 h-4 mr-2" />
            Organisation
          </TabsTrigger>
          <TabsTrigger value="team" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Users className="w-4 h-4 mr-2" />
            {t('settings.team')}
          </TabsTrigger>
          <TabsTrigger value="webhooks" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Webhook className="w-4 h-4 mr-2" />
            {t('settings.webhooks')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>

        <TabsContent value="organisation">
          {user?.orgId && <OrganisationSettings orgId={user.orgId} />}
        </TabsContent>

        <TabsContent value="team">
          {user?.orgId && <TeamSettings orgId={user.orgId} />}
        </TabsContent>

        <TabsContent value="webhooks">
          <WebhookSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileSettings() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const { data: profile, isLoading } = useGetMyProfile();
  const updateProfile = useUpdateMyProfile();
  
  const [name, setName] = useState('');
  const [language, setLanguage] = useState<'de' | 'en'>('de');

  React.useEffect(() => {
    if (profile) {
      setName(profile.name);
      setLanguage(profile.preferredLanguage || 'de');
    }
  }, [profile]);

  const handleSave = () => {
    updateProfile.mutate({
      data: { name, preferredLanguage: language }
    }, {
      onSuccess: () => {
        toast({ title: t('common.success') });
        i18n.changeLanguage(language);
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
      }
    });
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle>Personal Information</CardTitle>
        <CardDescription>Update your personal profile and preferences.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 max-w-md">
          <Label htmlFor="name">{t('settings.name')}</Label>
          <Input 
            id="name" 
            value={name} 
            onChange={(e) => setName(e.target.value)} 
          />
        </div>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="email">Email (Cannot be changed)</Label>
          <Input id="email" value={profile?.email || ''} disabled className="opacity-50" />
        </div>
        <div className="space-y-2 max-w-md">
          <Label htmlFor="language">{t('settings.language')}</Label>
          <Select value={language} onValueChange={(v: 'de' | 'en') => setLanguage(v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="de">Deutsch (DE)</SelectItem>
              <SelectItem value="en">English (EN)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
      <CardFooter className="border-t border-border/50 pt-6">
        <Button onClick={handleSave} disabled={updateProfile.isPending}>
          {updateProfile.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {t('settings.save')}
        </Button>
      </CardFooter>
    </Card>
  );
}

function TeamSettings({ orgId }: { orgId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: members, isLoading } = useListOrganizationMembers(orgId, {
    query: { enabled: !!orgId, queryKey: getListOrganizationMembersQueryKey(orgId) }
  });

  const addMember = useAddOrganizationMember();
  const removeMember = useRemoveOrganizationMember();

  const handleAddMember = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const email = formData.get('email') as string;
    const role = formData.get('role') as 'ADMIN' | 'MEMBER';

    addMember.mutate({
      orgId,
      data: { email, role }
    }, {
      onSuccess: () => {
        toast({ title: t('common.success') });
        queryClient.invalidateQueries({ queryKey: getListOrganizationMembersQueryKey(orgId) });
        (e.target as HTMLFormElement).reset();
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
      }
    });
  };

  const handleRemove = (userId: string) => {
    if (!confirm('Are you sure you want to remove this member?')) return;
    
    removeMember.mutate({ orgId, userId }, {
      onSuccess: () => {
        toast({ title: 'Member removed' });
        queryClient.invalidateQueries({ queryKey: getListOrganizationMembersQueryKey(orgId) });
      },
      onError: (err) => {
        toast({ title: t('common.error'), description: err.message, variant: 'destructive' });
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Invite Team Member</CardTitle>
          <CardDescription>Add colleagues to your organization to collaborate on projects.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddMember} className="flex items-end gap-4 max-w-2xl">
            <div className="space-y-2 flex-1">
              <Label htmlFor="new-email">Email Address</Label>
              <Input id="new-email" name="email" type="email" placeholder="colleague@company.com" required />
            </div>
            <div className="space-y-2 w-48">
              <Label htmlFor="role">Role</Label>
              <Select name="role" defaultValue="MEMBER">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MEMBER">Member</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={addMember.isPending}>
              <Plus className="w-4 h-4 mr-2" />
              Invite
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Team Members</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div>Loading...</div>
          ) : (
            <div className="divide-y divide-border/50 border border-border/50 rounded-md">
              {members?.map(member => (
                <div key={member.userId} className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-sm text-muted-foreground">{member.email}</div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs uppercase font-semibold bg-muted/50 px-2 py-1 rounded">
                      {member.role}
                    </span>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleRemove(member.userId)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function OrganisationSettings({ orgId }: { orgId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: orgs } = useGetMyOrganizations();
  const updateOrg = useUpdateOrganization();

  const myOrg = orgs?.find(o => o.organization.id === orgId)?.organization;

  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');

  React.useEffect(() => {
    if (myOrg) {
      setName(myOrg.name);
      setDescription(myOrg.description ?? '');
    }
  }, [myOrg]);

  const handleSave = () => {
    updateOrg.mutate({ orgId, data: { name, description: description || undefined } }, {
      onSuccess: () => {
        toast({ title: 'Gespeichert' });
        queryClient.invalidateQueries({ queryKey: getGetMyOrganizationsQueryKey() });
      },
      onError: (err) => {
        toast({ title: 'Fehler', description: err.message, variant: 'destructive' });
      }
    });
  };

  return (
    <Card className="bg-card">
      <CardHeader>
        <CardTitle>Firmendaten</CardTitle>
        <CardDescription>Bezeichnung und Beschreibung Ihrer Organisation.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label htmlFor="org-name">Firmenbezeichnung</Label>
          <Input
            id="org-name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Firmenname"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="org-desc">Beschreibung</Label>
          <textarea
            id="org-desc"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Kurze Beschreibung Ihres Unternehmens …"
            rows={4}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
        </div>
      </CardContent>
      <CardFooter className="border-t border-border/50 pt-6">
        <Button onClick={handleSave} disabled={updateOrg.isPending || !name}>
          {updateOrg.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Speichern
        </Button>
      </CardFooter>
    </Card>
  );
}

function WebhookSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: webhooks, isLoading } = useListWebhooks({ query: { queryKey: getListWebhooksQueryKey() } });
  const { data: events } = useListWebhookEvents(undefined, { query: { queryKey: getListWebhookEventsQueryKey() } });

  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const url = formData.get('url') as string;
    const secret = formData.get('secret') as string;
    
    // Hardcode some events for now
    const events = ['delegation.confirmed', 'delegation.alternative_proposed', 'delegation.rejected'];

    createWebhook.mutate({
      data: { url, secret: secret || undefined, events }
    }, {
      onSuccess: () => {
        toast({ title: 'Webhook created' });
        queryClient.invalidateQueries({ queryKey: getListWebhooksQueryKey() });
        (e.target as HTMLFormElement).reset();
      },
      onError: (err) => {
        toast({ title: 'Error', description: err.message, variant: 'destructive' });
      }
    });
  };

  return (
    <div className="space-y-6">
      <Card className="bg-card">
        <CardHeader>
          <CardTitle>Add Webhook Endpoint</CardTitle>
          <CardDescription>Receive real-time updates when delegations change state.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="space-y-4 max-w-2xl">
            <div className="space-y-2">
              <Label>Payload URL</Label>
              <Input name="url" type="url" placeholder="https://api.yourcompany.com/webhooks/taktkoord" required />
            </div>
            <div className="space-y-2">
              <Label>Secret (Optional)</Label>
              <Input name="secret" type="password" placeholder="Used to sign webhook payloads" />
            </div>
            <Button type="submit" disabled={createWebhook.isPending}>
              <Plus className="w-4 h-4 mr-2" />
              Add Webhook
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card">
          <CardHeader>
            <CardTitle>Active Webhooks</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? <div>Loading...</div> : webhooks?.length === 0 ? (
              <div className="text-muted-foreground text-sm">No webhooks configured.</div>
            ) : (
              <div className="space-y-3">
                {webhooks?.map(wh => (
                  <div key={wh.id} className="p-3 border border-border/50 rounded-lg flex justify-between items-start">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${wh.active ? 'bg-emerald-500' : 'bg-muted'}`} />
                        <span className="font-medium text-sm truncate max-w-[250px]">{wh.url}</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-1 flex-wrap">
                        {wh.events.map(ev => (
                          <span key={ev} className="bg-muted/50 px-1.5 py-0.5 rounded">{ev}</span>
                        ))}
                      </div>
                    </div>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-destructive h-8 w-8"
                      onClick={() => {
                        if (confirm('Delete webhook?')) {
                          deleteWebhook.mutate({ webhookId: wh.id }, {
                            onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWebhooksQueryKey() })
                          });
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card">
          <CardHeader>
            <CardTitle>Recent Events</CardTitle>
          </CardHeader>
          <CardContent>
            {events?.length === 0 ? (
              <div className="text-muted-foreground text-sm">No recent events.</div>
            ) : (
              <div className="space-y-2">
                {events?.slice(0, 5).map(ev => (
                  <div key={ev.id} className="p-2 border border-border/50 rounded flex justify-between items-center text-sm">
                    <div>
                      <div className="font-medium">{ev.event}</div>
                      <div className="text-xs text-muted-foreground">{format(new Date(ev.createdAt), 'MMM d, HH:mm')}</div>
                    </div>
                    <Badge variant={ev.status === 'DELIVERED' ? 'default' : ev.status === 'FAILED' ? 'destructive' : 'secondary'}>
                      {ev.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
