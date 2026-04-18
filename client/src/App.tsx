import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import AdminSettings from "@/components/AdminSettings";
import { Button } from "@/components/ui/button";
import { Settings as SettingsIcon, Moon, Sun } from "lucide-react";
import Dashboard from "@/pages/Dashboard";
import Proofs from "@/pages/Proofs";
import Verification from "@/pages/Verification";
import StatusLists from "@/pages/StatusLists";
import AuditLogs from "@/pages/AuditLogs";
import Settings from "@/pages/Settings";
import Demo from "@/pages/Demo";
import ApiKeys from "@/pages/ApiKeys";
import FailedMints from "@/pages/FailedMints";
import Partners from "@/pages/Partners";
import NotFound from "@/pages/not-found";
// Phase 7: public + admin transparency surfaces
import Transparency from "@/pages/Transparency";
import PublicVerify from "@/pages/PublicVerify";
import AppealsQueue from "@/pages/AppealsQueue";

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
      <Route path="/failed-mints" component={FailedMints} />
      <Route path="/partners" component={Partners} />
      <Route path="/settings" component={Settings} />
      {/* Phase 7 public surfaces (no auth required): */}
      <Route path="/transparency" component={Transparency} />
      <Route path="/verify/:proofAssetId" component={PublicVerify} />
      {/* Phase 7 admin surfaces (auth-gated by server, UI shown to all): */}
      <Route path="/appeals" component={AppealsQueue} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isDev = import.meta.env.DEV;

  // Dark mode: localStorage > system preference > default light
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('par-theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('par-theme', dark ? 'dark' : 'light');
  }, [dark]);

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
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDark(!dark)}
                    data-testid="button-theme-toggle"
                    className="h-8 w-8"
                  >
                    {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                  </Button>
                  {isDev && (
                    <Button
                      onClick={() => setSettingsOpen(true)}
                      variant="outline"
                      size="sm"
                      data-testid="button-admin-settings"
                    >
                      <SettingsIcon className="h-4 w-4 mr-2" />
                      Admin Settings
                    </Button>
                  )}
                </div>
              </header>
              <main className="flex-1 overflow-y-auto bg-background">
                <Router />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
        {isDev && <AdminSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
