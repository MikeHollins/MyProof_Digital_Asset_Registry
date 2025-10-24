import { Badge } from "@/components/ui/badge";
import type { ProofFormat } from "@shared/schema";

interface ProofFormatBadgeProps {
  format: ProofFormat;
  className?: string;
}

export function ProofFormatBadge({ format, className = "" }: ProofFormatBadgeProps) {
  const variants: Record<ProofFormat, { label: string; color: string }> = {
    ZK_PROOF: {
      label: "ZK Proof",
      color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    },
    JWS: {
      label: "JWS",
      color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    },
    LD_PROOF: {
      label: "LD Proof",
      color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
    },
    HW_ATTESTATION: {
      label: "HW Attestation",
      color: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
    },
    MERKLE_PROOF: {
      label: "Merkle Proof",
      color: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
    },
    BLOCKCHAIN_TX_PROOF: {
      label: "Blockchain TX",
      color: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
    },
    OTHER: {
      label: "Other",
      color: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    },
  };

  const config = variants[format];

  return (
    <Badge
      variant="secondary"
      className={`rounded px-2 py-0.5 text-xs font-medium ${config.color} ${className}`}
      data-testid={`badge-format-${format}`}
    >
      {config.label}
    </Badge>
  );
}
