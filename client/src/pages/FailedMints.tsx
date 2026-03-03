import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AlertTriangle, RefreshCw, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

// Reuse admin auth helper from ApiKeys
function getAdminToken(): string | null {
    return localStorage.getItem("par_admin_token");
}

function authHeaders(): Record<string, string> {
    const token = getAdminToken();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
}

async function fetchJSON(url: string, init?: RequestInit) {
    const resp = await fetch(url, {
        ...init,
        headers: { ...authHeaders(), "Content-Type": "application/json", ...init?.headers },
    });
    if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${resp.status}`);
    }
    return resp.json();
}

interface MintFailure {
    failureId: string;
    sessionId: string;
    tenantId: string;
    proofDigest: string;
    errorMessage: string;
    errorCode: string | null;
    httpStatus: number | null;
    attempts: number;
    maxRetries: number;
    resolved: boolean;
    resolvedAt: string | null;
    resolvedBy: string | null;
    createdAt: string;
    updatedAt: string;
}

function StatCard({ title, value, icon: Icon, color }: { title: string; value: string | number; icon: any; color: string }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
                <div className={`w-8 h-8 rounded flex items-center justify-center ${color}`}>
                    <Icon className="h-4 w-4 text-white" />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-semibold">{value}</div>
            </CardContent>
        </Card>
    );
}

export default function FailedMints() {
    const { toast } = useToast();

    const { data, isLoading, error } = useQuery<{ count: number; failures: MintFailure[] }>({
        queryKey: ["/api/admin/failed-mints"],
        queryFn: () => fetchJSON("/api/admin/failed-mints?limit=100"),
        refetchInterval: 30000, // Poll every 30s
    });

    const retryMutation = useMutation({
        mutationFn: () => fetchJSON("/api/admin/retry-failed-mints", { method: "POST" }),
        onSuccess: (result: any) => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/failed-mints"] });
            toast({
                title: "Retry Complete",
                description: `${result.retried} retried, ${result.resolved} resolved`,
            });
        },
        onError: (err: Error) => {
            toast({ title: "Retry Failed", description: err.message, variant: "destructive" });
        },
    });

    const failures = data?.failures ?? [];
    const totalCount = data?.count ?? 0;
    const exhausted = failures.filter(f => f.attempts >= f.maxRetries).length;
    const retryable = totalCount - exhausted;

    // Auth check
    if (!getAdminToken()) {
        return (
            <div className="p-8 space-y-4">
                <h1 className="text-4xl font-semibold text-foreground">Failed Mints</h1>
                <Card>
                    <CardContent className="p-8 text-center space-y-3">
                        <AlertTriangle className="h-12 w-12 mx-auto text-yellow-600" />
                        <p className="text-muted-foreground">Admin token required to view failed mints.</p>
                        <p className="text-sm text-muted-foreground">
                            Configure your admin token in <strong>API Keys → Admin Settings</strong>.
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="p-8 space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-4xl font-semibold text-foreground">Failed Mints</h1>
                    <p className="text-muted-foreground mt-2">Dead letter queue for async mint failures</p>
                </div>
                <Button
                    onClick={() => retryMutation.mutate()}
                    disabled={retryMutation.isPending || totalCount === 0}
                    data-testid="button-retry-all"
                >
                    <RefreshCw className={`h-4 w-4 mr-2 ${retryMutation.isPending ? "animate-spin" : ""}`} />
                    Retry All ({retryable})
                </Button>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <StatCard
                    title="Unresolved"
                    value={isLoading ? "..." : totalCount}
                    icon={totalCount > 0 ? XCircle : CheckCircle2}
                    color={totalCount > 0 ? "bg-red-600" : "bg-green-600"}
                />
                <StatCard
                    title="Retryable"
                    value={isLoading ? "..." : retryable}
                    icon={RefreshCw}
                    color="bg-blue-600"
                />
                <StatCard
                    title="Exhausted"
                    value={isLoading ? "..." : exhausted}
                    icon={AlertTriangle}
                    color="bg-yellow-600"
                />
            </div>

            {/* Failures Table */}
            <Card>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="p-6 space-y-3">
                            {[...Array(3)].map((_, i) => (
                                <Skeleton key={i} className="h-12 w-full" />
                            ))}
                        </div>
                    ) : error ? (
                        <div className="p-8 text-center text-destructive">
                            <AlertTriangle className="h-12 w-12 mx-auto mb-3" />
                            <p>{(error as Error).message}</p>
                        </div>
                    ) : failures.length === 0 ? (
                        <div className="p-8 text-center">
                            <CheckCircle2 className="h-12 w-12 mx-auto text-green-600 mb-3" />
                            <p className="text-lg font-medium">All Clear</p>
                            <p className="text-muted-foreground mt-1">No failed mints in the queue.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="border-b border-border bg-muted/50">
                                    <tr>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Session</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Tenant</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Error</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Attempts</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Created</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {failures.map((f, idx) => (
                                        <tr
                                            key={f.failureId}
                                            className={`border-b border-border last:border-0 hover-elevate ${idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                                                }`}
                                            data-testid={`row-failure-${f.failureId}`}
                                        >
                                            <td className="p-4">
                                                <code className="text-sm font-mono text-muted-foreground">
                                                    {f.sessionId.slice(0, 12)}...
                                                </code>
                                            </td>
                                            <td className="p-4 text-sm">{f.tenantId}</td>
                                            <td className="p-4">
                                                <span className="text-sm text-destructive">{f.errorMessage.slice(0, 60)}</span>
                                                {f.errorCode && (
                                                    <Badge variant="outline" className="ml-2 text-xs">{f.errorCode}</Badge>
                                                )}
                                            </td>
                                            <td className="p-4 text-sm font-mono">
                                                {f.attempts}/{f.maxRetries}
                                            </td>
                                            <td className="p-4">
                                                {f.attempts >= f.maxRetries ? (
                                                    <Badge variant="destructive">Exhausted</Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-yellow-600">
                                                        <Clock className="h-3 w-3 mr-1" />
                                                        Pending
                                                    </Badge>
                                                )}
                                            </td>
                                            <td className="p-4 text-sm text-muted-foreground">
                                                {new Date(f.createdAt).toLocaleString()}
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
    );
}
