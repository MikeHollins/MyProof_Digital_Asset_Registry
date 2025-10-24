import { CheckCircle2, Clock, XCircle, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export type VerificationStatus = "verified" | "pending" | "revoked" | "suspended";

interface StatusBadgeProps {
  status: VerificationStatus;
  className?: string;
}

export function StatusBadge({ status, className = "" }: StatusBadgeProps) {
  const variants = {
    verified: {
      icon: CheckCircle2,
      label: "Verified",
      color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      dotColor: "bg-green-600",
    },
    pending: {
      icon: Clock,
      label: "Pending Verification",
      color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      dotColor: "bg-yellow-600",
    },
    revoked: {
      icon: XCircle,
      label: "Revoked",
      color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      dotColor: "bg-red-600",
    },
    suspended: {
      icon: AlertCircle,
      label: "Suspended",
      color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
      dotColor: "bg-orange-600",
    },
  };

  const config = variants[status];
  const Icon = config.icon;

  return (
    <Badge
      variant="secondary"
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 ${config.color} ${className}`}
      data-testid={`badge-status-${status}`}
    >
      <span className={`w-2 h-2 rounded-full ${config.dotColor}`} />
      <Icon className="h-3.5 w-3.5" />
      <span className="text-xs font-medium">{config.label}</span>
    </Badge>
  );
}
