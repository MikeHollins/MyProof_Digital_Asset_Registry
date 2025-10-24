import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface CidDisplayProps {
  value: string;
  truncateLength?: number;
  className?: string;
}

export function CidDisplay({ value, truncateLength = 24, className = "" }: CidDisplayProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncated = value.length > truncateLength 
    ? `${value.slice(0, truncateLength / 2)}...${value.slice(-truncateLength / 2)}`
    : value;

  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <code className="bg-muted text-muted-foreground rounded px-2 py-1 text-sm font-mono hover-elevate cursor-default">
              {truncated}
            </code>
          </TooltipTrigger>
          <TooltipContent className="max-w-md break-all">
            <p className="font-mono text-xs">{value}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Button
        size="icon"
        variant="ghost"
        onClick={handleCopy}
        data-testid="button-copy-cid"
        className="h-6 w-6"
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}
