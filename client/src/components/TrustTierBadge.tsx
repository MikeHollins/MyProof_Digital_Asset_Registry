import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type TrustLevel,
  toMarketing,
  toASL,
  toNistIAL,
  toEidas,
  MARKETING_LABELS,
  ASL_LABELS,
  MARKETING_COLOR,
} from "@/lib/trust-ladder";
import { Shield, ShieldCheck, ShieldAlert } from "lucide-react";

interface TrustTierBadgeProps {
  trustLevel: TrustLevel;
  /** 'marketing' (merchant-facing, public site) | 'canonical' (regulator-facing, audit) | 'both'. Default 'marketing'. */
  variant?: "marketing" | "canonical" | "both";
  withLiveness?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const ICON_FOR_TIER = {
  maximum: ShieldCheck,
  enhanced: Shield,
  standard: ShieldAlert,
} as const;

export function TrustTierBadge({
  trustLevel,
  variant = "marketing",
  withLiveness = true,
  size = "md",
  className,
}: TrustTierBadgeProps) {
  const marketing = toMarketing(trustLevel);
  const asl = toASL(trustLevel, withLiveness);
  const nistIAL = toNistIAL(trustLevel);
  const eidas = toEidas(trustLevel);
  const Icon = ICON_FOR_TIER[marketing];

  const primaryLabel = variant === "canonical" ? ASL_LABELS[asl] : MARKETING_LABELS[marketing];

  const sizeClass = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base",
  }[size];

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid={`trust-tier-badge-${marketing}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-medium",
              MARKETING_COLOR[marketing],
              sizeClass,
              className,
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{primaryLabel}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <div className="space-y-1 text-xs">
            <div><span className="font-semibold">Marketing:</span> {MARKETING_LABELS[marketing]}</div>
            <div><span className="font-semibold">Canonical:</span> {ASL_LABELS[asl]}</div>
            <div><span className="font-semibold">NIST SP 800-63-4:</span> {nistIAL}</div>
            <div><span className="font-semibold">eIDAS LoA:</span> {eidas}</div>
            <div className="pt-1 text-muted-foreground">Internal code: <code>{trustLevel}</code></div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
