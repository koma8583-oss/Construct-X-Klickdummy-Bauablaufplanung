import React from 'react';
import { useTranslation } from 'react-i18next';
import { useGetAgDashboard } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Briefcase, AlertTriangle, CheckCircle, Clock, Activity } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';

export default function Dashboard() {
  const { t } = useTranslation();
  const { data: dashboard, isLoading } = useGetAgDashboard();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.title')}</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="bg-card">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-4 rounded-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-1/3 mb-1" />
                <Skeleton className="h-3 w-1/4" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <Skeleton className="h-96 w-full rounded-xl" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const stats = [
    {
      title: t('dashboard.projects'),
      value: dashboard?.totalProjects || 0,
      description: `${dashboard?.activeProjects || 0} active`,
      icon: Briefcase,
      color: 'text-blue-500',
    },
    {
      title: t('dashboard.pending'),
      value: dashboard?.pendingDelegations || 0,
      description: 'Waiting for response',
      icon: Clock,
      color: 'text-amber-500',
    },
    {
      title: t('dashboard.critical'),
      value: dashboard?.criticalProposals || 0,
      description: 'Requires attention',
      icon: AlertTriangle,
      color: 'text-destructive',
    },
    {
      title: t('dashboard.confirmed'),
      value: dashboard?.confirmedDelegations || 0,
      description: 'Ready to execute',
      icon: CheckCircle,
      color: 'text-emerald-500',
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.title')}</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <Card key={i} className="bg-card border-card-border overflow-hidden relative">
            <div className={`absolute top-0 right-0 p-4 opacity-10 ${stat.color}`}>
              <stat.icon className="w-16 h-16" />
            </div>
            <CardHeader className="flex flex-row items-center justify-between pb-2 relative z-10">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.title}
              </CardTitle>
              <stat.icon className={`h-4 w-4 ${stat.color}`} />
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="text-3xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-card-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Clock className="w-5 h-5 text-primary" />
              {t('dashboard.upcoming')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard?.upcomingTakte && dashboard.upcomingTakte.length > 0 ? (
              <div className="space-y-4">
                {dashboard.upcomingTakte.map((takt) => (
                  <div key={takt.id} className="flex items-center justify-between p-3 rounded-lg bg-background border border-border">
                    <div>
                      <div className="font-medium text-sm">Takt {takt.taktNumber} - {takt.gewerk}</div>
                      <div className="text-xs text-muted-foreground mt-1">Zone: {takt.zone}</div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-foreground">
                        {format(new Date(takt.plannedStart), 'MMM d')} - {format(new Date(takt.plannedEnd), 'MMM d')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No upcoming takte in the next 7 days.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-card-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-primary" />
              {t('dashboard.recentActivity')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dashboard?.recentActivity && dashboard.recentActivity.length > 0 ? (
              <div className="space-y-4">
                {dashboard.recentActivity.map((activity) => (
                  <div key={activity.id} className="flex flex-col gap-1 p-3 rounded-lg border border-border bg-background">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm truncate max-w-[200px]">
                        {activity.anOrganization?.name || 'Contractor'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        activity.status === 'CONFIRMED' ? 'bg-emerald-500/10 text-emerald-500' :
                        activity.status === 'PENDING' ? 'bg-amber-500/10 text-amber-500' :
                        activity.status === 'ALTERNATIVE_PROPOSED' ? 'bg-blue-500/10 text-blue-500' :
                        'bg-red-500/10 text-red-500'
                      }`}>
                        {activity.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Requested {format(new Date(activity.requestedStart), 'MMM d')} - {format(new Date(activity.requestedEnd), 'MMM d')}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No recent activity.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
