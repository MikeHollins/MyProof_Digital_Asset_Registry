import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, TreeDeciduous, Search, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { AuditEvent } from "@shared/schema";

interface MerkleRootResponse {
  count: number;
  root: string;
  algorithm: string;
}

interface InclusionProofResponse {
  eventId: string;
  path: string[];
  leafIndex: number;
  treeSize: number;
}

export default function AuditLogs() {
  const { toast } = useToast();
  const [eventIdInput, setEventIdInput] = useState("");
  const [merkleRoot, setMerkleRoot] = useState<MerkleRootResponse | null>(null);
  const [inclusionProof, setInclusionProof] = useState<InclusionProofResponse | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingProof, setLoadingProof] = useState(false);

  const { data: events, isLoading: eventsLoading } = useQuery<AuditEvent[]>({
    queryKey: ['/api/audit-events'],
  });

  const handleGetRoot = async () => {
    setLoadingRoot(true);
    try {
      const response = await apiRequest('GET', '/api/audit/root');
      const data: MerkleRootResponse = await response.json();
      setMerkleRoot(data);
      toast({
        title: "Success",
        description: `Merkle root computed for ${data.count} events`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fetch Merkle root",
        variant: "destructive",
      });
    } finally {
      setLoadingRoot(false);
    }
  };

  const handleGetProof = async () => {
    if (!eventIdInput.trim()) {
      toast({
        title: "Error",
        description: "Please enter an event ID",
        variant: "destructive",
      });
      return;
    }

    setLoadingProof(true);
    try {
      const response = await apiRequest('GET', `/api/audit/proof/${eventIdInput.trim()}`);
      const data: InclusionProofResponse = await response.json();
      setInclusionProof(data);
      toast({
        title: "Success",
        description: "Inclusion proof retrieved successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to fetch inclusion proof",
        variant: "destructive",
      });
      setInclusionProof(null);
    } finally {
      setLoadingProof(false);
    }
  };

  const handleEventClick = (eventId: string) => {
    setEventIdInput(eventId);
    setInclusionProof(null);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Copied to clipboard",
    });
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">Audit Logs</h1>
        <p className="text-muted-foreground mt-2">
          Append-only transparency log with Merkle tree verification
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Merkle Root Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TreeDeciduous className="h-5 w-5" />
              Merkle Root
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Compute the Merkle root hash of all audit events
            </p>
            <Button
              onClick={handleGetRoot}
              disabled={loadingRoot}
              data-testid="button-get-root"
              className="w-full"
            >
              {loadingRoot ? "Computing..." : "Get Root"}
            </Button>

            {merkleRoot && (
              <div className="space-y-3 pt-4 border-t">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Count</p>
                  <p className="font-mono text-sm" data-testid="text-root-count">
                    {merkleRoot.count}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Root Hash</p>
                  <div className="flex items-start gap-2">
                    <code
                      className="font-mono text-xs bg-muted p-2 rounded flex-1 break-all"
                      data-testid="text-root-hash"
                    >
                      {merkleRoot.root}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => copyToClipboard(merkleRoot.root)}
                      data-testid="button-copy-root"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Algorithm</p>
                  <p className="font-mono text-sm" data-testid="text-root-algorithm">
                    {merkleRoot.algorithm}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Inclusion Proof Panel */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Inclusion Proof by event_id
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="event-id-input" className="text-sm text-muted-foreground">
                Event ID (UUID)
              </label>
              <Input
                id="event-id-input"
                value={eventIdInput}
                onChange={(e) => setEventIdInput(e.target.value)}
                placeholder="Enter event ID..."
                className="font-mono"
                data-testid="input-event-id"
              />
            </div>
            <Button
              onClick={handleGetProof}
              disabled={loadingProof || !eventIdInput.trim()}
              data-testid="button-get-proof"
              className="w-full"
            >
              {loadingProof ? "Fetching..." : "Get Proof"}
            </Button>

            {inclusionProof && (
              <div className="pt-4 border-t">
                <p className="text-xs text-muted-foreground mb-2">Proof Result</p>
                <pre
                  className="bg-muted p-4 rounded font-mono text-xs overflow-x-auto"
                  data-testid="text-proof-result"
                >
                  {JSON.stringify(inclusionProof, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Events Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Recent Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eventsLoading ? (
            <p className="text-center text-muted-foreground py-8">Loading events...</p>
          ) : !events || events.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No audit events recorded</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left text-sm font-medium text-muted-foreground py-3 px-4">
                      Event ID
                    </th>
                    <th className="text-left text-sm font-medium text-muted-foreground py-3 px-4">
                      Event Type
                    </th>
                    <th className="text-left text-sm font-medium text-muted-foreground py-3 px-4">
                      Timestamp
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, index) => (
                    <tr
                      key={event.eventId}
                      className="border-b hover-elevate"
                      data-testid={`row-event-${index}`}
                    >
                      <td className="py-3 px-4">
                        <button
                          onClick={() => handleEventClick(event.eventId)}
                          className="font-mono text-sm text-primary hover:underline"
                          data-testid={`button-event-id-${index}`}
                        >
                          {event.eventId}
                        </button>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm" data-testid={`text-event-type-${index}`}>
                          {event.eventType}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="text-sm text-muted-foreground" data-testid={`text-timestamp-${index}`}>
                          {new Date(event.timestamp).toLocaleString()}
                        </span>
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
