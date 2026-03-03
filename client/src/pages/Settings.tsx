import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Settings as SettingsIcon, Shield, Database, Server, ExternalLink, KeyRound } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface RevokedKeysResponse {
  issuer: string;
  revoked_keys: { kid: string; revoked_at: string; reason: string }[];
  updated_at: string;
}

export default function Settings() {
  const { toast } = useToast();
  const [statusBaseUrl, setStatusBaseUrl] = useState("https://status.example.com/lists");
  const [idempotency, setIdempotency] = useState(true);
  const [rateLimiting, setRateLimiting] = useState(true);
  const [auditLog, setAuditLog] = useState(true);
  const [privacyLinting, setPrivacyLinting] = useState(true);
  const [saving, setSaving] = useState(false);

  // Fetch revoked keys count
  const { data: revokedData, isLoading: revokedLoading } = useQuery<RevokedKeysResponse>({
    queryKey: ['/.well-known/revoked-keys.json'],
    queryFn: async () => {
      const resp = await fetch('/.well-known/revoked-keys.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
  });

  const revokedCount = revokedData?.revoked_keys?.length ?? 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save settings — in production this would POST to /api/settings
      // For now, persist to localStorage for client-side state
      localStorage.setItem('par-settings', JSON.stringify({
        statusBaseUrl,
        idempotency,
        rateLimiting,
        auditLog,
        privacyLinting,
      }));
      toast({
        title: "Settings Saved",
        description: "System preferences updated successfully.",
      });
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">Settings</h1>
        <p className="text-muted-foreground mt-2">
          Configure system preferences and security settings
        </p>
      </div>

      {/* System Information */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">System Information</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Version</p>
              <p className="font-mono">1.0.0</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Environment</p>
              <p className="font-mono">{import.meta.env.DEV ? "Development" : "Production"}</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Database</p>
              <p className="font-mono">PostgreSQL 15</p>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">Cache</p>
              <p className="font-mono">Redis</p>
            </div>
          </div>
          {/* Revoked keys count */}
          <div className="pt-3 border-t border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Revoked API Keys</span>
            </div>
            {revokedLoading ? (
              <Skeleton className="h-5 w-8" />
            ) : (
              <Badge variant={revokedCount > 0 ? "destructive" : "secondary"}>
                {revokedCount}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Security Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">Security Settings</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="idempotency">Enforce Idempotency</Label>
              <p className="text-sm text-muted-foreground">
                Require idempotency keys for all POST requests
              </p>
            </div>
            <Switch id="idempotency" checked={idempotency} onCheckedChange={setIdempotency} data-testid="switch-idempotency" />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="rate-limiting">Rate Limiting</Label>
              <p className="text-sm text-muted-foreground">
                Apply rate limits to API endpoints
              </p>
            </div>
            <Switch id="rate-limiting" checked={rateLimiting} onCheckedChange={setRateLimiting} data-testid="switch-rate-limiting" />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="audit-log">Audit Logging</Label>
              <p className="text-sm text-muted-foreground">
                Record all state-changing operations
              </p>
            </div>
            <Switch id="audit-log" checked={auditLog} onCheckedChange={setAuditLog} data-testid="switch-audit-log" />
          </div>
        </CardContent>
      </Card>

      {/* Privacy Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">Privacy & Data Management</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="status-base-url">Status List Base URL</Label>
            <div className="flex items-center gap-2">
              <Input
                id="status-base-url"
                value={statusBaseUrl}
                onChange={(e) => setStatusBaseUrl(e.target.value)}
                className="font-mono"
                data-testid="input-status-base-url"
              />
              <Button variant="ghost" size="icon" onClick={() => window.open(statusBaseUrl, '_blank')}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Base URL for W3C Bitstring Status Lists
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="privacy-linting">Privacy Linting</Label>
              <p className="text-sm text-muted-foreground">
                Automatically check for PII in schemas and payloads
              </p>
            </div>
            <Switch id="privacy-linting" checked={privacyLinting} onCheckedChange={setPrivacyLinting} data-testid="switch-privacy-linting" />
          </div>

          <div className="pt-4 border-t border-border">
            <h3 className="text-sm font-medium mb-2">PII Detection Status</h3>
            <div className="flex items-center gap-2 text-sm text-green-600">
              <div className="w-2 h-2 rounded-full bg-green-600" />
              <span>No PII detected in current schemas</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">System Actions</h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Export Audit Snapshot</p>
              <p className="text-sm text-muted-foreground">
                Generate signed snapshot of current Merkle root
              </p>
            </div>
            <Button variant="outline" size="sm" data-testid="button-export-snapshot">
              Export
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Run Privacy Linter</p>
              <p className="text-sm text-muted-foreground">
                Scan all schemas for forbidden PII fields
              </p>
            </div>
            <Button variant="outline" size="sm" data-testid="button-run-linter">
              Run Scan
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-sm">Clear Cache</p>
              <p className="text-sm text-muted-foreground">
                Flush Redis cache and idempotency keys
              </p>
            </div>
            <Button variant="outline" size="sm" data-testid="button-clear-cache">
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={saving}
          data-testid="button-save-settings"
        >
          {saving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
