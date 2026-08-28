import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect, useParams } from 'wouter';

import '@/i18n'; // Initialize i18n
import { AuthProvider } from '@/contexts/auth-context';
import { AuthGuard } from '@/components/auth-guard';
import { Layout } from '@/components/layout';

// Pages
import Login from '@/pages/login';
import Register from '@/pages/register';
import Dashboard from '@/pages/dashboard';
import Projects from '@/pages/projects';
import ProjectDetail from '@/pages/project-detail';
import TaktDetail from '@/pages/takt-detail';
import ProjectProposals from '@/pages/project-proposals';
import Leistungsanfragen from '@/pages/leistungsanfragen';
import LeistungsanfragenDetail from '@/pages/leistungsanfragen-detail';
import Settings from '@/pages/settings';
import NotFound from '@/pages/not-found';
import PolicyLibrary from '@/pages/policy-library';
import DatenraumPage from '@/pages/datenraum';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function TaktRequestsLegacyRedirect() {
  const { requestId } = useParams<{ requestId: string }>();
  return <Redirect to={`/leistungsanfragen/${requestId}`} />;
}

function AuthenticatedApp() {
  return (
    <AuthGuard>
      <Layout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/projects" component={Projects} />
          <Route path="/projects/:projectId/takte/:taktId" component={TaktDetail} />
          <Route path="/projects/:projectId" component={ProjectDetail} />
          <Route path="/projects/:projectId/proposals" component={ProjectProposals} />
          <Route path="/leistungsanfragen" component={Leistungsanfragen} />
          <Route path="/leistungsanfragen/:requestId" component={LeistungsanfragenDetail} />
          <Route path="/data-room" component={DatenraumPage} />
          <Route path="/data-room/policies/:code" component={PolicyLibrary} />
          <Route path="/data-room/policies" component={PolicyLibrary} />
          <Route path="/takt-requests">
            <Redirect to="/leistungsanfragen" />
          </Route>
          <Route path="/takt-requests/:requestId" component={TaktRequestsLegacyRedirect} />
          <Route path="/settings" component={Settings} />
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </AuthGuard>
  );
}

function AppRouter() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      <Route component={AuthenticatedApp} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <AppRouter />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
