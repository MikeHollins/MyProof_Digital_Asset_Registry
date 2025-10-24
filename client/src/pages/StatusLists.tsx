import { useQuery } from "@tanstack/react-query";
import { List, Activity } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CidDisplay } from "@/components/CidDisplay";
import type { StatusList } from "@shared/schema";

export default function StatusLists() {
  const { data: statusLists, isLoading } = useQuery<StatusList[]>({
    queryKey: ['/api/status-lists'],
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-4xl font-semibold text-foreground">Status Lists</h1>
        <p className="text-muted-foreground mt-2">
          W3C Bitstring Status List management for revocation and suspension
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Loading status lists...
          </CardContent>
        </Card>
      ) : !statusLists || statusLists.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <List className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No status lists available</h3>
            <p className="text-muted-foreground">
              Status lists will be created automatically when proofs are registered
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {statusLists.map((list) => (
            <Card key={list.listId} className="hover-elevate" data-testid={`card-status-list-${list.listId}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <List className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-medium">
                        {list.purpose.charAt(0).toUpperCase() + list.purpose.slice(1)} List
                      </h3>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {list.size.toLocaleString()} entries
                    </Badge>
                  </div>
                  <Activity className="h-6 w-6 text-muted-foreground" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">List ID</p>
                  <CidDisplay value={list.listId} truncateLength={24} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">URL</p>
                  <code className="text-xs font-mono text-muted-foreground break-all">
                    {list.url}
                  </code>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-card-border pt-3">
                  <span>Created: {new Date(list.createdAt).toLocaleDateString()}</span>
                  <span>Updated: {new Date(list.updatedAt).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
