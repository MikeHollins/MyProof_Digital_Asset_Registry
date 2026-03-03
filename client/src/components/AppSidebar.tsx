import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Shield,
  CheckCircle,
  List,
  FileText,
  PlayCircle,
  Settings,
  Key,
  AlertTriangle,
  Users,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuBadge,
  SidebarHeader,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Proofs",
    url: "/proofs",
    icon: Shield,
  },
  {
    title: "Verification",
    url: "/verification",
    icon: CheckCircle,
  },
  {
    title: "Partners",
    url: "/partners",
    icon: Users,
  },
  {
    title: "API Keys",
    url: "/api-keys",
    icon: Key,
  },
  {
    title: "Status Lists",
    url: "/status-lists",
    icon: List,
  },
  {
    title: "Audit Logs",
    url: "/audit-logs",
    icon: FileText,
  },
  {
    title: "Failed Mints",
    url: "/failed-mints",
    icon: AlertTriangle,
  },
  {
    title: "Demo",
    url: "/demo",
    icon: PlayCircle,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  // Fetch failed mint count for badge
  const { data: statsData } = useQuery<{ failedMintCount?: number }>({
    queryKey: ['/api/stats'],
    refetchInterval: 60000, // poll every 60s
  });
  const failedMintCount = (statsData as any)?.failedMintCount ?? 0;

  return (
    <Sidebar>
      <SidebarHeader className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <Shield className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-sidebar-foreground">
              PAR
            </h2>
            <p className="text-xs text-muted-foreground">Proof Registry</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => {
                const isActive = location === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={isActive} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <Link href={item.url}>
                        <item.icon className="h-4 w-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                    {item.title === "Failed Mints" && failedMintCount > 0 && (
                      <SidebarMenuBadge className="bg-destructive text-destructive-foreground text-xs">
                        {failedMintCount}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
