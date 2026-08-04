import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AuthProvider } from '@/contexts/auth';
import { useAuth } from '@/contexts/auth';
import { Layout } from '@/components/layout';
import { Loader2 } from 'lucide-react';
import './i18n/config';

import Login from '@/pages/login';
import Register from '@/pages/register';
import Dashboard from '@/pages/dashboard';
import Requests from '@/pages/requests';
import RequestDetail from '@/pages/request-detail';
import TaktRequestsInbox from '@/pages/takt-requests-inbox';
import TaktRequestDetail from '@/pages/takt-request-detail';
import GanttPage from '@/pages/gantt';
import Resources from '@/pages/resources';
import Settings from '@/pages/settings';
import LocalProjects from '@/pages/local-projects';
import ResourceBookings from '@/pages/resource-bookings';
import AvailabilityChecks from '@/pages/availability-checks';
import Reports from '@/pages/reports';

const queryClient = new QueryClient();

/**
 * Auth-aware router: renders login/register when not authenticated,
 * and the protected app when authenticated — without any URL redirects.
 * This avoids the Replit preview pane resetting the URL when wouter
 * tries to navigate from /an/ to /an/login.
 */
function AuthRoutedApp() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <Switch>
        <Route path="/register" component={Register} />
        <Route component={Login} />
      </Switch>
    );
  }

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/requests" component={Requests} />
        <Route path="/requests/:delegationId" component={RequestDetail} />
        <Route path="/takt-requests" component={TaktRequestsInbox} />
        <Route path="/takt-requests/:requestId" component={TaktRequestDetail} />
        <Route path="/local-projects" component={LocalProjects} />
        <Route path="/resource-bookings" component={ResourceBookings} />
        <Route path="/availability-checks" component={AvailabilityChecks} />
        <Route path="/reports" component={Reports} />
        <Route path="/gantt" component={GanttPage} />
        <Route path="/resources" component={Resources} />
        <Route path="/settings" component={Settings} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AuthRoutedApp />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
