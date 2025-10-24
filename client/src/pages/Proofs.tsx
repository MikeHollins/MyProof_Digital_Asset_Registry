import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Shield, Grid3x3, Table2, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/StatusBadge";
import { ProofFormatBadge } from "@/components/ProofFormatBadge";
import { CidDisplay } from "@/components/CidDisplay";
import type { ProofAsset } from "@shared/schema";

type ViewMode = "grid" | "table";

export default function Proofs() {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [formatFilter, setFormatFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [didFilter, setDidFilter] = useState<string>("");

  const { data: proofs, isLoading } = useQuery<ProofAsset[]>({
    queryKey: ['/api/proof-assets'],
  });

  const filteredProofs = proofs?.filter((proof) => {
    if (formatFilter !== "all" && proof.proofFormat !== formatFilter) return false;
    if (statusFilter !== "all" && proof.verificationStatus !== statusFilter) return false;
    if (didFilter && !proof.issuerDid.toLowerCase().includes(didFilter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-semibold text-foreground">Proof Assets</h1>
          <p className="text-muted-foreground mt-2">
            Manage and explore registered cryptographic proofs
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "grid" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("grid")}
            data-testid="button-view-grid"
          >
            <Grid3x3 className="h-4 w-4 mr-2" />
            Grid
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("table")}
            data-testid="button-view-table"
          >
            <Table2 className="h-4 w-4 mr-2" />
            Table
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">Filters</h2>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="format-filter">Proof Format</Label>
              <Select value={formatFilter} onValueChange={setFormatFilter}>
                <SelectTrigger id="format-filter" data-testid="select-format-filter">
                  <SelectValue placeholder="All Formats" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Formats</SelectItem>
                  <SelectItem value="ZK_PROOF">ZK Proof</SelectItem>
                  <SelectItem value="JWS">JWS</SelectItem>
                  <SelectItem value="LD_PROOF">LD Proof</SelectItem>
                  <SelectItem value="HW_ATTESTATION">HW Attestation</SelectItem>
                  <SelectItem value="MERKLE_PROOF">Merkle Proof</SelectItem>
                  <SelectItem value="BLOCKCHAIN_TX_PROOF">Blockchain TX</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="status-filter">Verification Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="status-filter" data-testid="select-status-filter">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                  <SelectItem value="suspended">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="did-filter">Issuer DID</Label>
              <Input
                id="did-filter"
                placeholder="Search by DID..."
                value={didFilter}
                onChange={(e) => setDidFilter(e.target.value)}
                data-testid="input-did-filter"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {isLoading ? (
        <div className="p-12 text-center text-muted-foreground">
          Loading proof assets...
        </div>
      ) : !filteredProofs || filteredProofs.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Shield className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No proofs found</h3>
            <p className="text-muted-foreground mb-6">
              {proofs && proofs.length > 0
                ? "Try adjusting your filters"
                : "Get started by registering your first proof"}
            </p>
            {(!proofs || proofs.length === 0) && (
              <Button data-testid="button-register-proof">
                Register New Proof
              </Button>
            )}
          </CardContent>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProofs.map((proof) => (
            <Card key={proof.proofAssetId} className="hover-elevate" data-testid={`card-proof-${proof.proofAssetId}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <ProofFormatBadge format={proof.proofFormat as any} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(proof.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Proof ID</Label>
                  <CidDisplay value={proof.proofAssetId} truncateLength={20} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Digest</Label>
                  <CidDisplay value={proof.proofDigest} truncateLength={20} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Issuer DID</Label>
                  <code className="block text-xs font-mono text-muted-foreground mt-1">
                    {proof.issuerDid.slice(0, 32)}...
                  </code>
                </div>
                <div>
                  <StatusBadge status={proof.verificationStatus as any} />
                </div>
              </CardContent>
              <CardFooter className="pt-3 border-t border-card-border flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" data-testid={`button-details-${proof.proofAssetId}`}>
                  View Details
                </Button>
                <Button variant="outline" size="sm" className="flex-1" data-testid={`button-verify-${proof.proofAssetId}`}>
                  Verify
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Proof ID
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Format
                    </th>
                    <th className="text-left p-4 text-sm font-medium text-muted-foreground">
                      Digest
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
                  {filteredProofs.map((proof, idx) => (
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
                        <CidDisplay value={proof.proofDigest} truncateLength={16} />
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
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" data-testid={`button-view-${proof.proofAssetId}`}>
                            View
                          </Button>
                          <Button variant="ghost" size="sm" data-testid={`button-verify-${proof.proofAssetId}`}>
                            Verify
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
