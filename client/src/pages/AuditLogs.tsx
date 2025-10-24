import { useQuery } from "@tanstack/react-query";
import { FileText, GitBranch } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CidDisplay } from "@/components/CidDisplay";
import type { AuditEvent } from "@shared/schema";

const eventTypeColors: Record<string, string> = {
  MINT: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  USE: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  TRANSFER: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
  STATUS_UPDATE: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
};

export default function AuditLogs() {
  const { data: events, isLoading } = useQuery<AuditEvent[]>({
    queryKey: ['/api/audit-events'],
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">Audit Logs</h1>
        <p className="text-muted-foreground mt-2">
          Append-only transparency log with hash-chain verification
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Loading audit events...
          </CardContent>
        </Card>
      ) : !events || events.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No audit events recorded</h3>
            <p className="text-muted-foreground">
              Events will appear here as proofs are registered and managed
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="relative">
          {/* Timeline connector */}
          <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-border" />

          <div className="space-y-6">
            {events.map((event, idx) => (
              <div key={event.eventId} className="relative pl-20" data-testid={`event-${event.eventId}`}>
                {/* Timeline dot */}
                <div className="absolute left-6 top-6 w-5 h-5 rounded-full bg-primary border-4 border-background" />

                <Card className="hover-elevate">
                  <CardContent className="p-6 space-y-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <Badge 
                          variant="secondary" 
                          className={eventTypeColors[event.eventType] || eventTypeColors.USE}
                        >
                          {event.eventType}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          {new Date(event.timestamp).toLocaleString()}
                        </span>
                        {event.traceId && (
                          <code className="text-xs font-mono text-muted-foreground">
                            Trace: {event.traceId.slice(0, 8)}
                          </code>
                        )}
                      </div>
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>

                    {event.assetId && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Asset ID</p>
                        <CidDisplay value={event.assetId} truncateLength={24} />
                      </div>
                    )}

                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Event Hash</p>
                      <CidDisplay value={event.eventHash} truncateLength={32} />
                    </div>

                    {event.previousHash && idx > 0 && (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-3 border-t border-card-border">
                        <GitBranch className="h-3 w-3" />
                        <span>Previous: </span>
                        <code className="font-mono">
                          {event.previousHash.slice(0, 16)}...
                        </code>
                      </div>
                    )}

                    {/* Payload preview */}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        View Payload
                      </summary>
                      <pre className="mt-2 p-3 bg-muted rounded font-mono text-xs overflow-x-auto">
                        {JSON.stringify(event.payload, null, 2)}
                      </pre>
                    </details>
                  </CardContent>
                </Card>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
