import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusBadge, type VerificationStatus } from "./StatusBadge";
import { Shield, Key, Clock } from "lucide-react";

interface VerificationDetailsProps {
  status: VerificationStatus;
  algorithm?: string | null;
  publicKeyDigest?: string | null;
  timestamp?: Date | string | null;
  metadata?: any;
}

export function VerificationDetails({
  status,
  algorithm,
  publicKeyDigest,
  timestamp,
  metadata,
}: VerificationDetailsProps) {
  const hasDetails = algorithm || publicKeyDigest || timestamp;

  if (!hasDetails) {
    return <StatusBadge status={status} />;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-block" data-testid="verification-details-trigger">
          <StatusBadge status={status} />
        </div>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm" data-testid="verification-details-tooltip">
        <div className="space-y-2">
          <div className="font-medium text-sm border-b pb-2 mb-2">
            Verification Details
          </div>
          
          {algorithm && (
            <div className="flex items-start gap-2 text-xs">
              <Shield className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
              <div>
                <div className="font-medium">Algorithm</div>
                <div className="text-muted-foreground font-mono">{algorithm}</div>
              </div>
            </div>
          )}
          
          {publicKeyDigest && (
            <div className="flex items-start gap-2 text-xs">
              <Key className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
              <div>
                <div className="font-medium">Public Key Digest</div>
                <div className="text-muted-foreground font-mono break-all">
                  {publicKeyDigest.slice(0, 32)}...
                </div>
              </div>
            </div>
          )}
          
          {timestamp && (
            <div className="flex items-start gap-2 text-xs">
              <Clock className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
              <div>
                <div className="font-medium">Verified At</div>
                <div className="text-muted-foreground">
                  {new Date(timestamp).toLocaleString()}
                </div>
              </div>
            </div>
          )}
          
          {metadata?.issuer && (
            <div className="text-xs pt-2 border-t">
              <div className="font-medium">Issuer</div>
              <div className="text-muted-foreground font-mono text-xs break-all">
                {metadata.issuer}
              </div>
            </div>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
