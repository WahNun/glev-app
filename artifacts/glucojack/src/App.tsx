import React, { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { isAuthenticated } from "@/lib/auth";

// Pages
import Dashboard from "@/pages/dashboard";
import QuickLog from "@/pages/log";
import ImportData from "@/pages/import";
import Insights from "@/pages/insights";
import Recommend from "@/pages/recommend";
import Entries from "@/pages/entries";
import VoiceLog from "@/pages/voice";
import Login from "@/pages/login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthGuard({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  useEffect(() => {
    if (!isAuthenticated() && location !== "/login") {
      setLocation("/login");
    }
  }, [location]);
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route>
        <AuthGuard>
          <Layout>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/log" component={QuickLog} />
              <Route path="/import" component={ImportData} />
              <Route path="/insights" component={Insights} />
              <Route path="/recommend" component={Recommend} />
              <Route path="/entries" component={Entries} />
              <Route path="/voice" component={VoiceLog} />
              <Route component={NotFound} />
            </Switch>
          </Layout>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
