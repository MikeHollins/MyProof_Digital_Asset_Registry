import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Users, Plus, Globe, Mail, Shield, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";

// Reuse admin auth helper
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

interface Partner {
    partnerId: string;
    name: string;
    contactEmail: string | null;
    webhookUrl: string | null;
    webhookSecret: string | null;
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

export default function Partners() {
    const { toast } = useToast();
    const [createOpen, setCreateOpen] = useState(false);
    const [newName, setNewName] = useState("");
    const [newEmail, setNewEmail] = useState("");
    const [newWebhookUrl, setNewWebhookUrl] = useState("");

    const { data: partners, isLoading, error } = useQuery<Partner[]>({
        queryKey: ["/api/admin/partners"],
        queryFn: () => fetchJSON("/api/admin/partners"),
    });

    const createMutation = useMutation({
        mutationFn: () =>
            fetchJSON("/api/admin/partners", {
                method: "POST",
                body: JSON.stringify({
                    name: newName,
                    contactEmail: newEmail || null,
                    webhookUrl: newWebhookUrl || null,
                }),
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
            setCreateOpen(false);
            setNewName("");
            setNewEmail("");
            setNewWebhookUrl("");
            toast({ title: "Partner Created" });
        },
        onError: (err: Error) => {
            toast({ title: "Failed", description: err.message, variant: "destructive" });
        },
    });

    // Auth check
    if (!getAdminToken()) {
        return (
            <div className="p-8 space-y-4">
                <h1 className="text-4xl font-semibold text-foreground">Partners</h1>
                <Card>
                    <CardContent className="p-8 text-center space-y-3">
                        <AlertTriangle className="h-12 w-12 mx-auto text-yellow-600" />
                        <p className="text-muted-foreground">Admin token required to manage partners.</p>
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
                    <h1 className="text-4xl font-semibold text-foreground">Partners</h1>
                    <p className="text-muted-foreground mt-2">Manage partner organizations and webhook configurations</p>
                </div>
                <Button onClick={() => setCreateOpen(true)} data-testid="button-create-partner">
                    <Plus className="h-4 w-4 mr-2" />
                    Add Partner
                </Button>
            </div>

            {/* Partners Table */}
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
                    ) : !partners || partners.length === 0 ? (
                        <div className="p-8 text-center">
                            <Users className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                            <p className="text-lg font-medium">No Partners Yet</p>
                            <p className="text-muted-foreground mt-1">Create your first partner organization.</p>
                            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
                                <Plus className="h-4 w-4 mr-2" /> Add Partner
                            </Button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="border-b border-border bg-muted/50">
                                    <tr>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Name</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Contact</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Webhook</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                                        <th className="text-left p-4 text-sm font-medium text-muted-foreground">Created</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {partners.map((p, idx) => (
                                        <tr
                                            key={p.partnerId}
                                            className={`border-b border-border last:border-0 hover-elevate ${idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                                                }`}
                                            data-testid={`row-partner-${p.partnerId}`}
                                        >
                                            <td className="p-4">
                                                <div className="flex items-center gap-2">
                                                    <Shield className="h-4 w-4 text-primary" />
                                                    <span className="font-medium">{p.name}</span>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                {p.contactEmail ? (
                                                    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                        <Mail className="h-3 w-3" />
                                                        {p.contactEmail}
                                                    </span>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground">—</span>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                {p.webhookUrl ? (
                                                    <span className="flex items-center gap-1.5 text-sm">
                                                        <Globe className="h-3 w-3 text-green-600" />
                                                        <code className="text-xs font-mono">{p.webhookUrl.slice(0, 40)}...</code>
                                                    </span>
                                                ) : (
                                                    <span className="text-sm text-muted-foreground">Not configured</span>
                                                )}
                                            </td>
                                            <td className="p-4">
                                                <Badge variant={p.active ? "default" : "secondary"}>
                                                    {p.active ? "Active" : "Inactive"}
                                                </Badge>
                                            </td>
                                            <td className="p-4 text-sm text-muted-foreground">
                                                {new Date(p.createdAt).toLocaleDateString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Create Partner Dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Add Partner</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="partner-name">Organization Name *</Label>
                            <Input
                                id="partner-name"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="e.g., Acme Bar & Grill"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="partner-email">Contact Email</Label>
                            <Input
                                id="partner-email"
                                type="email"
                                value={newEmail}
                                onChange={(e) => setNewEmail(e.target.value)}
                                placeholder="admin@partner.com"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="partner-webhook">Webhook URL</Label>
                            <Input
                                id="partner-webhook"
                                value={newWebhookUrl}
                                onChange={(e) => setNewWebhookUrl(e.target.value)}
                                placeholder="https://partner.com/webhooks/par"
                            />
                            <p className="text-xs text-muted-foreground">
                                Receives revocation and status change notifications
                            </p>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button
                            onClick={() => createMutation.mutate()}
                            disabled={!newName || createMutation.isPending}
                        >
                            {createMutation.isPending ? "Creating..." : "Create Partner"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
