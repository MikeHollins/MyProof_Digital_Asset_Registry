import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Key, Plus, Trash2, Settings, Copy, Check, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Helper to get admin token from localStorage
function getAdminToken() {
  return localStorage.getItem("ADMIN_API_TOKEN") || "";
}

// Helper to set headers with admin token
function authHeaders() {
  const token = getAdminToken();
  return token ? { Authorization: `ApiKey ${token}` } : {};
}

// Fetch helper with admin auth
async function fetchJSON(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

interface Partner {
  partnerId: string;
  name: string;
  contactEmail: string | null;
  active: boolean;
  createdAt: string;
}

interface ApiKey {
  keyId: string;
  partnerId: string;
  scopes: string;
  status: string;
  notBefore: string;
  notAfter: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

interface ApiKeyWithPartner extends ApiKey {
  partnerName?: string;
}

const AVAILABLE_SCOPES = [
  { value: "assets:mint", label: "Create Proof Assets", description: "Mint new proof assets" },
  { value: "assets:read", label: "Read Proof Assets", description: "View proof asset details" },
  { value: "status:update", label: "Update Status Lists", description: "Modify W3C Status List bits" },
  { value: "transfer:execute", label: "Execute Transfers", description: "Transfer proof assets" },
  { value: "audit:read", label: "Read Audit Logs", description: "View audit trail events" },
  { value: "admin:*", label: "Full Admin Access", description: "Complete administrative control" },
];

function AdminTokenSettings({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [token, setToken] = useState(getAdminToken());
  const { toast } = useToast();

  const handleSave = () => {
    localStorage.setItem("ADMIN_API_TOKEN", token);
    toast({
      title: "Admin token saved",
      description: "You can now use admin API endpoints",
    });
    onOpenChange(false);
    window.location.reload();
  };

  const handleBootstrap = async () => {
    try {
      const data = await fetch("/api/admin/bootstrap", { method: "POST" }).then(r => r.json());
      if (!data.ok) throw new Error(data.error);
      
      setToken(data.token);
      toast({
        title: "Bootstrap successful",
        description: `Admin key created: ${data.keyId}`,
      });
    } catch (e: any) {
      toast({
        title: "Bootstrap failed",
        description: e.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-admin-settings">
        <DialogHeader>
          <DialogTitle>Admin API Token Settings</DialogTitle>
          <DialogDescription>
            Configure your admin API key to manage partners and API keys
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="admin-token">Admin API Token</Label>
            <Input
              id="admin-token"
              data-testid="input-admin-token"
              type="password"
              placeholder="mpk_xxxxxx.xxxxxxxx..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Format: keyId.secret (e.g., mpk_abc123.hex64...)
            </p>
          </div>
          
          {process.env.NODE_ENV !== 'production' && (
            <div className="space-y-2 p-3 border rounded bg-muted/30">
              <p className="text-sm font-medium">Development Only: Bootstrap</p>
              <p className="text-xs text-muted-foreground mb-2">
                Create the first admin API key if you don't have one yet
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBootstrap}
                data-testid="button-bootstrap"
              >
                Bootstrap Admin Key
              </Button>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-settings">
            Cancel
          </Button>
          <Button onClick={handleSave} data-testid="button-save-token">
            Save Token
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TokenDisplayModal({
  open,
  onOpenChange,
  token,
  keyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  keyId: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="dialog-token-display">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            API Key Generated Successfully
          </DialogTitle>
          <DialogDescription>
            This is the only time you'll see the full API key. Copy it now and store it securely.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Key ID</Label>
            <div className="font-mono text-sm p-3 bg-muted rounded border">
              {keyId}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Full API Key Token (shown once)</Label>
            <div className="flex gap-2">
              <div className="flex-1 font-mono text-sm p-3 bg-muted rounded border break-all" data-testid="text-api-token">
                {token}
              </div>
              <Button
                size="icon"
                variant="outline"
                onClick={handleCopy}
                data-testid="button-copy-token"
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="space-y-2 p-4 border rounded bg-yellow-50 dark:bg-yellow-950/20">
            <h4 className="font-semibold text-sm">Security Notes</h4>
            <ul className="text-xs space-y-1 text-muted-foreground list-disc pl-4">
              <li>Store this key securely (password manager, secrets vault)</li>
              <li>Never commit this key to version control</li>
              <li>The secret is hashed with Argon2id and cannot be retrieved later</li>
              <li>If lost, you must rotate or revoke and issue a new key</li>
            </ul>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} data-testid="button-close-token-display">
            I've Saved the Key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GenerateKeyDialog({
  open,
  onOpenChange,
  partners,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partners: Partner[];
}) {
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [newToken, setNewToken] = useState<{ token: string; keyId: string } | null>(null);
  const { toast } = useToast();

  const generateMutation = useMutation({
    mutationFn: async () => {
      return fetchJSON("/api/admin/api-keys/issue", {
        method: "POST",
        body: JSON.stringify({
          partnerId: selectedPartnerId,
          scopes: selectedScopes,
        }),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      setNewToken({ token: data.token, keyId: data.keyId });
      setSelectedPartnerId("");
      setSelectedScopes([]);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to generate API key",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const toggleScope = (scope: string) => {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleGenerate = () => {
    if (!selectedPartnerId) {
      toast({
        title: "Partner required",
        description: "Please select a partner organization",
        variant: "destructive",
      });
      return;
    }
    if (selectedScopes.length === 0) {
      toast({
        title: "Scopes required",
        description: "Please select at least one scope",
        variant: "destructive",
      });
      return;
    }
    generateMutation.mutate();
  };

  return (
    <>
      <Dialog open={open && !newToken} onOpenChange={onOpenChange}>
        <DialogContent data-testid="dialog-generate-key">
          <DialogHeader>
            <DialogTitle>Generate New API Key</DialogTitle>
            <DialogDescription>
              Create a new API key for partner authentication with specific scopes
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="partner">Partner Organization</Label>
              <Select value={selectedPartnerId} onValueChange={setSelectedPartnerId}>
                <SelectTrigger id="partner" data-testid="select-partner">
                  <SelectValue placeholder="Select a partner" />
                </SelectTrigger>
                <SelectContent>
                  {partners.map((p) => (
                    <SelectItem key={p.partnerId} value={p.partnerId}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label>Scopes (select at least one)</Label>
              {AVAILABLE_SCOPES.map((scope) => (
                <div key={scope.value} className="flex items-start space-x-3 space-y-0">
                  <Checkbox
                    id={scope.value}
                    checked={selectedScopes.includes(scope.value)}
                    onCheckedChange={() => toggleScope(scope.value)}
                    data-testid={`checkbox-scope-${scope.value}`}
                  />
                  <div className="space-y-1 leading-none">
                    <Label
                      htmlFor={scope.value}
                      className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {scope.label}
                    </Label>
                    <p className="text-xs text-muted-foreground">{scope.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-generate">
              Cancel
            </Button>
            <Button
              onClick={handleGenerate}
              disabled={generateMutation.isPending}
              data-testid="button-confirm-generate"
            >
              {generateMutation.isPending ? "Generating..." : "Generate API Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {newToken && (
        <TokenDisplayModal
          open={!!newToken}
          onOpenChange={(open) => {
            if (!open) {
              setNewToken(null);
              onOpenChange(false);
            }
          }}
          token={newToken.token}
          keyId={newToken.keyId}
        />
      )}
    </>
  );
}

export default function ApiKeys() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: keysData, isLoading: keysLoading } = useQuery({
    queryKey: ["/api/admin/api-keys"],
    queryFn: () => fetchJSON("/api/admin/api-keys"),
    enabled: !!getAdminToken(),
  });

  const { data: partnersData, isLoading: partnersLoading } = useQuery({
    queryKey: ["/api/admin/partners"],
    queryFn: () => fetchJSON("/api/admin/partners"),
    enabled: !!getAdminToken(),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) =>
      fetchJSON(`/api/admin/api-keys/${keyId}/revoke`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/api-keys"] });
      toast({
        title: "API key revoked",
        description: "The API key has been successfully revoked",
      });
      setRevokeKeyId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to revoke key",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const partners: Partner[] = partnersData?.partners || [];
  const keys: ApiKey[] = keysData?.keys || [];

  // Enrich keys with partner names
  const keysWithPartners: ApiKeyWithPartner[] = keys.map((key) => ({
    ...key,
    partnerName: partners.find((p) => p.partnerId === key.partnerId)?.name || "Unknown",
  }));

  const hasAdminToken = !!getAdminToken();

  if (!hasAdminToken) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <Key className="h-12 w-12 mx-auto text-muted-foreground" />
            <h2 className="text-xl font-semibold">Admin Authentication Required</h2>
            <p className="text-muted-foreground">
              You need an admin API token to manage API keys and partners
            </p>
            <Button onClick={() => setSettingsOpen(true)} data-testid="button-open-settings">
              <Settings className="h-4 w-4 mr-2" />
              Set Admin Token
            </Button>
          </CardContent>
        </Card>

        <AdminTokenSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-semibold text-foreground">API Keys</h1>
          <p className="text-muted-foreground mt-2">
            Manage partner API keys for multi-tenant authentication
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(true)} data-testid="button-admin-settings">
            <Settings className="h-4 w-4 mr-2" />
            Admin Settings
          </Button>
          <Button onClick={() => setGenerateOpen(true)} data-testid="button-generate-new-key">
            <Plus className="h-4 w-4 mr-2" />
            Generate New Key
          </Button>
        </div>
      </div>

      {/* Active Keys Table */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">
            Active API Keys ({keysWithPartners.filter((k) => k.status === "active").length})
          </h2>
        </CardHeader>
        <CardContent>
          {keysLoading || partnersLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : keysWithPartners.filter((k) => k.status === "active").length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No active API keys. Generate one to get started.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b">
                  <tr className="text-left">
                    <th className="pb-3 font-medium">Key ID</th>
                    <th className="pb-3 font-medium">Partner</th>
                    <th className="pb-3 font-medium">Scopes</th>
                    <th className="pb-3 font-medium">Created</th>
                    <th className="pb-3 font-medium">Last Used</th>
                    <th className="pb-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {keysWithPartners
                    .filter((k) => k.status === "active")
                    .map((key) => (
                      <tr key={key.keyId} data-testid={`row-api-key-${key.keyId}`}>
                        <td className="py-3 font-mono text-xs">{key.keyId}</td>
                        <td className="py-3">{key.partnerName}</td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-1">
                            {key.scopes.split(",").map((scope) => (
                              <span
                                key={scope}
                                className="px-2 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium"
                              >
                                {scope}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {new Date(key.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-3 text-muted-foreground">
                          {key.lastUsedAt
                            ? new Date(key.lastUsedAt).toLocaleDateString()
                            : "Never"}
                        </td>
                        <td className="py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setRevokeKeyId(key.keyId)}
                            data-testid={`button-revoke-${key.keyId}`}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
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

      {/* Security Notes */}
      <Card>
        <CardHeader>
          <h2 className="text-lg font-semibold">Security Notes</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <h3 className="font-semibold mb-2">API Key Storage</h3>
              <p className="text-muted-foreground">
                API keys are hashed with Argon2id and server-side pepper. Secrets are never stored
                in plaintext and cannot be retrieved after generation.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Key Rotation</h3>
              <p className="text-muted-foreground">
                Rotate keys periodically for security. Revoke old keys after a grace period to
                allow partner integrations to update.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Environment Separation</h3>
              <p className="text-muted-foreground">
                Use different API keys for sandbox, test, and production environments to maintain
                security boundaries.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Emergency Revocation</h3>
              <p className="text-muted-foreground">
                If a key is compromised, revoke it immediately. Partners must generate a new key to
                continue using the API.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <AdminTokenSettings open={settingsOpen} onOpenChange={setSettingsOpen} />
      <GenerateKeyDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        partners={partners}
      />

      <AlertDialog open={!!revokeKeyId} onOpenChange={() => setRevokeKeyId(null)}>
        <AlertDialogContent data-testid="dialog-confirm-revoke">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke API Key?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately revoke the API key. The partner will no longer be able to
              authenticate with this key. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-revoke">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => revokeKeyId && revokeMutation.mutate(revokeKeyId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-revoke"
            >
              Revoke Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
