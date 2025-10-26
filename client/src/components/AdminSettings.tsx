import { useState } from "react";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { AlertCircle } from "lucide-react";

export default function AdminSettings({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [stored, setStored] = useLocalStorage("ADMIN_API_TOKEN", "");
  const [temp, setTemp] = useState<string>(stored);
  const { toast } = useToast();

  async function testToken() {
    try {
      const res = await fetch("/api/admin/ping", {
        method: "GET",
        headers: { "Authorization": temp }
      });
      const data = await res.json();
      if (res.ok && data?.ok) {
        toast({
          title: "Token valid",
          description: "admin:* scope confirmed",
        });
      } else {
        toast({
          variant: "destructive",
          title: "Ping failed",
          description: JSON.stringify(data),
        });
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Ping failed",
        description: String(e.message || e),
      });
    }
  }

  function save() {
    setStored(temp);
    toast({
      title: "Token saved",
      description: "Admin token saved to localStorage",
    });
  }

  function clearToken() {
    setStored("");
    setTemp("");
    toast({
      title: "Token cleared",
      description: "Admin token removed from localStorage",
    });
  }

  function copyToken() {
    if (!temp) return;
    navigator.clipboard.writeText(temp).then(() => {
      toast({
        title: "Copied",
        description: "Token copied to clipboard",
      });
    }).catch(() => {});
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Admin Settings (dev only)</DialogTitle>
          <DialogDescription>
            Paste your admin API token here (format: <code className="text-xs font-mono">ApiKey &lt;KEYID&gt;.&lt;SECRET&gt;</code>).
            This is stored in <code className="text-xs font-mono">localStorage.ADMIN_API_TOKEN</code> for development only.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="admin-token">Admin API Token</Label>
            <Textarea
              id="admin-token"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              className="font-mono text-sm min-h-[100px]"
              placeholder="ApiKey mpk_admin.abcdef0123456789..."
              data-testid="textarea-admin-token"
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button onClick={save} data-testid="button-save-token">
              Save
            </Button>
            <Button onClick={testToken} variant="outline" data-testid="button-test-token">
              Test Token
            </Button>
            <Button onClick={copyToken} variant="outline" data-testid="button-copy-token">
              Copy
            </Button>
            <Button onClick={clearToken} variant="outline" data-testid="button-clear-token">
              Clear
            </Button>
          </div>

          <div className="flex items-start gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-300 dark:border-yellow-800 rounded">
            <AlertCircle className="h-4 w-4 text-yellow-700 dark:text-yellow-400 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-yellow-900 dark:text-yellow-200">
              <strong>Security Note:</strong> Never use this modal in production. In production, use your
              operator login and server-side sessions. This is a developer convenience for local demos.
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose} variant="outline" data-testid="button-close-settings">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
