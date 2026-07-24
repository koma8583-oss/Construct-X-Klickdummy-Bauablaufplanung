import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'wouter';
import { format } from 'date-fns';
import { 
  useListProjects, 
  useCreateProject,
  getListProjectsQueryKey 
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, ChevronRight, Briefcase, Calendar, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export default function Projects() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  
  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const location = formData.get('location') as string;
    const startDate = formData.get('startDate') as string;
    const endDate = formData.get('endDate') as string;

    createProject.mutate({
      data: { name, description, location, startDate, endDate }
    }, {
      onSuccess: (newProject) => {
        toast({ title: t('common.success') });
        queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey() });
        setIsCreateOpen(false);
        setLocation(`/projects/${newProject.id}`);
      },
      onError: (err) => {
        toast({ 
          title: t('common.error'), 
          description: err.message,
          variant: 'destructive' 
        });
      }
    });
  };

  const filteredProjects = projects?.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    (p.description && p.description.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('projects.title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage and oversee all construction projects.
          </p>
        </div>

        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t('projects.create')}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{t('projects.newProject')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('projects.name')}</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">{t('projects.description')}</Label>
                <Input id="description" name="description" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="location">{t('projects.location')}</Label>
                <Input id="location" name="location" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="startDate">{t('projects.startDate')}</Label>
                  <Input id="startDate" name="startDate" type="date" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endDate">{t('projects.endDate')}</Label>
                  <Input id="endDate" name="endDate" type="date" required />
                </div>
              </div>
              <DialogFooter className="mt-6">
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={createProject.isPending}>
                  {t('common.save')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center space-x-2 max-w-sm">
        <Search className="w-4 h-4 text-muted-foreground absolute ml-3" />
        <Input 
          placeholder={t('projects.search')} 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 bg-card"
        />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : filteredProjects?.length === 0 ? (
        <div className="text-center py-16 px-4 border border-dashed rounded-xl border-border bg-card/50">
          <Briefcase className="w-12 h-12 mx-auto text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">{t('projects.noProjects')}</h3>
          <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
            Get started by creating your first construction project to manage timelines and subcontractors.
          </p>
          <Button onClick={() => setIsCreateOpen(true)} className="mt-6" variant="outline">
            <Plus className="w-4 h-4 mr-2" />
            {t('projects.create')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects?.map(project => (
            <Link key={project.id} href={`/projects/${project.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer group bg-card h-full flex flex-col">
                <CardContent className="p-5 flex flex-col flex-1">
                  <div className="flex justify-between items-start mb-4">
                    <div className="font-semibold text-lg line-clamp-1 group-hover:text-primary transition-colors">
                      {project.name}
                    </div>
                    <Badge variant={project.status === 'ACTIVE' ? 'default' : 'secondary'} className="ml-2">
                      {project.status}
                    </Badge>
                  </div>
                  
                  {project.description && (
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                      {project.description}
                    </p>
                  )}
                  
                  <div className="mt-auto space-y-3 pt-4 border-t border-border/50">
                    <div className="flex items-center text-xs text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5 mr-2 opacity-70" />
                      {project.startDate ? format(new Date(project.startDate), 'MMM d, yyyy') : 'TBD'} - 
                      {project.endDate ? format(new Date(project.endDate), 'MMM d, yyyy') : 'TBD'}
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center text-xs text-muted-foreground">
                        <Users className="w-3.5 h-3.5 mr-2 opacity-70" />
                        {project.taktCount} Takte • {project.delegationCount} Delegations
                      </div>
                      
                      {project.pendingResponseCount > 0 && (
                        <div className="flex items-center text-xs font-medium text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 animate-pulse" />
                          {project.pendingResponseCount} pending
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
