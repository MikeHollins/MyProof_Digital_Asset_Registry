import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import Dashboard from "@/pages/Dashboard";
import Proofs from "@/pages/Proofs";
import Verification from "@/pages/Verification";
import StatusLists from "@/pages/StatusLists";
import AuditLogs from "@/pages/AuditLogs";
import Settings from "@/pages/Settings";
import Demo from "@/pages/Demo";
import ApiKeys from "@/pages/ApiKeys";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/proofs" component={Proofs} />
      <Route path="/verification" component={Verification} />
      <Route path="/status-lists" component={StatusLists} />
      <Route path="/audit-logs" component={AuditLogs} />
      <Route path="/demo" component={Demo} />
      <Route path="/api-keys" component={ApiKeys} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar />
            <div className="flex flex-col flex-1 overflow-hidden">
              <header className="flex items-center justify-between p-4 border-b border-border bg-background">
                <SidebarTrigger data-testid="button-sidebar-toggle" />
                <div className="flex items-center gap-4">
                  <div className="text-sm">
                    <span className="text-muted-foreground">System Status:</span>
                    <span className="ml-2 inline-flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-600" />
                      <span className="text-foreground font-medium">Operational</span>
                    </span>
                  </div>
                </div>
              </header>
              <main className="flex-1 overflow-y-auto bg-background">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
