import { useQuery } from "@tanstack/react-query";
import { Shield, CheckCircle2, List, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { ProofFormatBadge } from "@/components/ProofFormatBadge";
import { CidDisplay } from "@/components/CidDisplay";
import type { DashboardStats, SystemHealth, ProofAsset } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

function StatCard({ 
  icon: Icon, 
  title, 
  value, 
  iconColor 
}: { 
  icon: any; 
  title: string; 
  value: string | number; 
  iconColor: string;
}) {
  return (
    <Card data-testid={`card-stat-${title.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <div className={`w-8 h-8 rounded flex items-center justify-center ${iconColor}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold" data-testid={`text-${title.toLowerCase().replace(/\s+/g, '-')}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function HealthIndicator({ 
  service, 
  status 
}: { 
  service: string; 
  status: 'healthy' | 'degraded' | 'down';
}) {
  const statusColors = {
    healthy: 'bg-green-600',
    degraded: 'bg-yellow-600',
    down: 'bg-red-600',
  };

  const statusLabels = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    down: 'Down',
  };

  return (
    <Card data-testid={`card-health-${service.toLowerCase().replace(/\s+/g, '-')}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{service}</span>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${statusColors[status]}`} />
            <span className="text-xs text-muted-foreground">{statusLabels[status]}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['/api/stats'],
  });

  const { data: health, isLoading: healthLoading } = useQuery<SystemHealth>({
    queryKey: ['/api/health'],
  });

  const { data: recentProofs, isLoading: proofsLoading } = useQuery<ProofAsset[]>({
    queryKey: ['/api/proof-assets/recent'],
  });

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Privacy-first cryptographic proof management overview
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={Shield}
          title="Total Proofs"
          value={statsLoading ? "..." : (stats?.totalProofs ?? 0)}
          iconColor="bg-primary"
        />
        <StatCard
          icon={CheckCircle2}
          title="Verified Today"
          value={statsLoading ? "..." : (stats?.verifiedToday ?? 0)}
          iconColor="bg-green-600"
        />
        <StatCard
          icon={List}
          title="Active Status Lists"
          value={statsLoading ? "..." : (stats?.activeStatusLists ?? 0)}
          iconColor="bg-blue-600"
        />
        <StatCard
          icon={Clock}
          title="Pending Verifications"
          value={statsLoading ? "..." : (stats?.pendingVerifications ?? 0)}
          iconColor="bg-yellow-600"
        />
      </div>

      {/* Recent Verifications Table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-semibold">Recent Verifications</h2>
          <Link href="/proofs">
            <Button variant="outline" size="sm" data-testid="button-view-all-proofs">
              View All
            </Button>
          </Link>
        </div>
        
        <Card>
          <CardContent className="p-0">
            {proofsLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading recent verifications...
              </div>
            ) : !recentProofs || recentProofs.length === 0 ? (
              <div className="p-8 text-center">
                <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">No proofs registered yet</p>
                <Link href="/verification">
                  <Button variant="default" className="mt-4" data-testid="button-register-first-proof">
                    Register Your First Proof
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border bg-muted/50">
                    <tr>
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                        Proof ID
                      </th>
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                        Format
                      </th>
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                        Issuer DID
                      </th>
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                        Created
                      </th>
                      <th className="text-right p-4 text-sm font-medium text-muted-foreground">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentProofs.slice(0, 10).map((proof, idx) => (
                      <tr
                        key={proof.proofAssetId}
                        className={`border-b border-border last:border-0 hover-elevate ${
                          idx % 2 === 0 ? 'bg-background' : 'bg-muted/20'
                        }`}
                        data-testid={`row-proof-${proof.proofAssetId}`}
                      >
                        <td className="p-4">
                          <CidDisplay value={proof.proofAssetId} truncateLength={16} />
                        </td>
                        <td className="p-4">
                          <ProofFormatBadge format={proof.proofFormat as any} />
                        </td>
                        <td className="p-4">
                          <code className="text-sm font-mono text-muted-foreground">
                            {proof.issuerDid.slice(0, 24)}...
                          </code>
                        </td>
                        <td className="p-4">
                          <StatusBadge status={proof.verificationStatus as any} />
                        </td>
                        <td className="p-4 text-sm text-muted-foreground">
                          {new Date(proof.createdAt).toLocaleDateString()}
                        </td>
                        <td className="p-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            data-testid={`button-view-${proof.proofAssetId}`}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* System Health Indicators */}
      <div>
        <h2 className="text-2xl font-semibold mb-4">System Health</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <HealthIndicator
            service="Database"
            status={healthLoading ? 'healthy' : (health?.database ?? 'healthy')}
          />
          <HealthIndicator
            service="Redis Cache"
            status={healthLoading ? 'healthy' : (health?.redis ?? 'healthy')}
          />
          <HealthIndicator
            service="Verifier Service"
            status={healthLoading ? 'healthy' : (health?.verifier ?? 'healthy')}
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-2xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="hover-elevate cursor-pointer" data-testid="card-quick-register">
            <Link href="/verification">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center">
                    <Shield className="h-6 w-6 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-medium text-lg mb-1">Register New Proof</h3>
                    <p className="text-sm text-muted-foreground">
                      Submit a new cryptographic proof for verification and registry
                    </p>
                  </div>
                </div>
              </CardContent>
            </Link>
          </Card>

          <Card className="hover-elevate cursor-pointer" data-testid="card-quick-verify">
            <Link href="/verification">
              <CardContent className="p-6">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded bg-green-600/10 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-medium text-lg mb-1">Check Verification Status</h3>
                    <p className="text-sm text-muted-foreground">
                      Verify the status of an existing proof asset by ID
                    </p>
                  </div>
                </div>
              </CardContent>
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
