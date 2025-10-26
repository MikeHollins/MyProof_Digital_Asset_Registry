import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, TreeDeciduous, Search, Copy, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

interface RecentEvent {
  event_id: string;
  event_type: string;
  asset_id: string | null;
  payload_preview: string;
  created_at: string;
}

export default function AuditLogs() {
  const { toast } = useToast();
  const [eventIdInput, setEventIdInput] = useState("");
  const [merkleRoot, setMerkleRoot] = useState<MerkleRootResponse | null>(null);
  const [inclusionProof, setInclusionProof] = useState<InclusionProofResponse | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingProof, setLoadingProof] = useState(false);

  // Recent Events state
  const [searchQuery, setSearchQuery] = useState("");
  const [limit, setLimit] = useState(50);

  // Fetch recent events with search and pagination  
  const { data: recentEventsData, isLoading: recentEventsLoading, refetch: refetchEvents } = useQuery<{ok: boolean; rows: RecentEvent[]}>({
    queryKey: ['/api/audit/events', searchQuery, limit],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      params.set('limit', String(limit));
      const url = `/api/audit/events?${params.toString()}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      return response.json();
    },
  });

  const recentEvents = recentEventsData?.rows || [];

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

  const handleSelectEvent = (eventId: string) => {
    setEventIdInput(eventId);
    setInclusionProof(null);
    toast({
      title: "Event Selected",
      description: "Event ID filled. Click 'Get Proof' to generate inclusion proof.",
    });
  };

  const truncate = (str: string, len: number = 48) => {
    if (!str) return "—";
    return str.length > len ? str.slice(0, len) + "…" : str;
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">Audit Logs</h1>
        <p className="text-muted-foreground mt-2">
          Append-only transparency log with Merkle tree verification
        </p>
      </div>

      {/* Recent Events Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Recent Events
            </CardTitle>
            <div className="flex items-center gap-2">
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search event type or asset ID..."
                className="w-64"
                data-testid="input-search-events"
              />
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="border rounded px-3 py-2 text-sm"
                data-testid="select-limit"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetchEvents()}
                disabled={recentEventsLoading}
                data-testid="button-refresh-events"
              >
                <RefreshCw className={`h-4 w-4 ${recentEventsLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b">
                <tr className="text-left">
                  <th className="pb-3 font-medium">Event ID</th>
                  <th className="pb-3 font-medium">Type</th>
                  <th className="pb-3 font-medium">Asset ID</th>
                  <th className="pb-3 font-medium">Payload</th>
                  <th className="pb-3 font-medium">Created</th>
                  <th className="pb-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {recentEventsLoading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      Loading events...
                    </td>
                  </tr>
                ) : recentEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted-foreground">
                      No audit events found
                    </td>
                  </tr>
                ) : (
                  recentEvents.map((event) => (
                    <tr key={event.event_id} data-testid={`row-event-${event.event_id}`}>
                      <td className="py-3 font-mono text-xs">{truncate(event.event_id, 22)}</td>
                      <td className="py-3">
                        <Badge variant="outline" data-testid={`badge-event-type-${event.event_id}`}>
                          {event.event_type}
                        </Badge>
                      </td>
                      <td className="py-3 font-mono text-xs">{truncate(event.asset_id || "—", 22)}</td>
                      <td className="py-3 font-mono text-xs text-muted-foreground">
                        {truncate(event.payload_preview, 40)}
                      </td>
                      <td className="py-3 text-muted-foreground">{formatDate(event.created_at)}</td>
                      <td className="py-3 text-right space-x-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(event.event_id)}
                          data-testid={`button-copy-${event.event_id}`}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSelectEvent(event.event_id)}
                          data-testid={`button-select-${event.event_id}`}
                        >
                          Select
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
    </div>
  );
}
