import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

// Pages
import Dashboard from "@/pages/dashboard";
import QuickLog from "@/pages/log";
import ImportData from "@/pages/import";
import Insights from "@/pages/insights";
import Recommend from "@/pages/recommend";
import Entries from "@/pages/entries";
import VoiceLog from "@/pages/voice";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
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
