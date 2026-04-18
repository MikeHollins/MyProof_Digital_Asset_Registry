// Appeals reviewer queue — admin-scoped Art. 22 / EDPB Statement 1/2025 review UI.
//
// Lists open + in_review appeals sorted by SLA (most-urgent-first).
// Free_text is OMITTED from the list view to reduce accidental exposure;
// reviewer must click "Open" to see the detail, and free_text is redacted
// server-side when pii_flagged=true unless explicitly requested via unredact.

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Scale, Clock, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";

interface AppealListItem {
  appeal_id: string;
  verification_id: string | null;
  session_id_hint: string | null;
  category: "incorrect_rejection" | "technical_error" | "policy_dispute" | "other";
  pii_flagged: boolean;
  status: "open" | "in_review" | "resolved" | "rejected";
  assigned_reviewer: string | null;
  sla_due_at: string;
  created_at: string;
}

interface AppealDetail extends AppealListItem {
  free_text: string | null;
  resolution: string | null;
  resolved_at: string | null;
  updated_at: string;
}

const CATEGORY_LABELS = {
  incorrect_rejection: "Incorrect rejection",
  technical_error: "Technical error",
  policy_dispute: "Policy dispute",
  other: "Other",
} as const;

const STATUS_VARIANT: Record<AppealListItem["status"], "default" | "secondary" | "destructive" | "outline"> = {
  open: "destructive",
  in_review: "secondary",
  resolved: "default",
  rejected: "outline",
};

function SlaCountdown({ dueAt }: { dueAt: string }) {
  const due = new Date(dueAt).getTime();
  const now = Date.now();
  const diffDays = Math.floor((due - now) / (24 * 60 * 60 * 1000));
  const overdue = diffDays < 0;
  const urgent = diffDays <= 3 && !overdue;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${overdue ? "text-destructive font-semibold" : urgent ? "text-amber-600" : "text-muted-foreground"}`}>
      <Clock className="h-3 w-3" />
      {overdue ? `${-diffDays}d overdue` : `${diffDays}d remaining`}
    </span>
  );
}

export default function AppealsQueue() {
  const [selected, setSelected] = useState<string | null>(null);
  const [unredact, setUnredact] = useState(false);
  const qc = useQueryClient();

  const list = useQuery<{ ok: boolean; appeals: AppealListItem[] }>({
    queryKey: ["/api/admin/appeals"],
  });

  const detail = useQuery<{ ok: boolean; appeal: AppealDetail }>({
    queryKey: [selected ? `/api/admin/appeals/${selected}${unredact ? "?unredact=true" : ""}` : null],
    enabled: !!selected,
  });

  const resolveMutation = useMutation({
    mutationFn: async (args: { appealId: string; outcome: "resolved" | "rejected"; resolution: string; reviewer: string }) => {
      return apiRequest(`/api/admin/appeals/${args.appealId}/resolve`, {
        method: "POST",
        body: JSON.stringify({
          outcome: args.outcome,
          resolution: args.resolution,
          reviewer: args.reviewer,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/appeals"] });
      setSelected(null);
    },
  });

  const [form, setForm] = useState({ reviewer: "", resolution: "", outcome: "resolved" as "resolved" | "rejected" });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Scale className="h-7 w-7 text-primary" />
          Appeals Queue
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Art. 22 GDPR / EDPB Statement 1/2025 human-review queue. 30-day SLA per appeal.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Open + in-review</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : list.data?.appeals?.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Category</th>
                    <th className="pb-2 pr-3">PII flag</th>
                    <th className="pb-2 pr-3">SLA</th>
                    <th className="pb-2 pr-3">Assigned</th>
                    <th className="pb-2 pr-3">Created</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.appeals.map((a) => (
                    <tr key={a.appeal_id} className="border-b hover-elevate">
                      <td className="py-2 pr-3">
                        <Badge variant={STATUS_VARIANT[a.status]}>{a.status}</Badge>
                      </td>
                      <td className="py-2 pr-3">{CATEGORY_LABELS[a.category]}</td>
                      <td className="py-2 pr-3">
                        {a.pii_flagged ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
                            <AlertTriangle className="h-3 w-3" /> PII
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">clean</span>
                        )}
                      </td>
                      <td className="py-2 pr-3"><SlaCountdown dueAt={a.sla_due_at} /></td>
                      <td className="py-2 pr-3 font-mono text-xs">{a.assigned_reviewer ?? "—"}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{new Date(a.created_at).toLocaleDateString()}</td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setSelected(a.appeal_id); setUnredact(false); }}
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-600" />
              No open appeals.
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Appeal detail</DialogTitle>
            <DialogDescription>
              Reviewer-only view. Free-text is redacted when PII was auto-detected.
            </DialogDescription>
          </DialogHeader>

          {detail.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : detail.data?.appeal ? (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">Category</dt>
                  <dd>{CATEGORY_LABELS[detail.data.appeal.category]}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Status</dt>
                  <dd><Badge variant={STATUS_VARIANT[detail.data.appeal.status]}>{detail.data.appeal.status}</Badge></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Verification ID</dt>
                  <dd className="font-mono text-xs">{detail.data.appeal.verification_id ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Session hint</dt>
                  <dd className="font-mono text-xs">{detail.data.appeal.session_id_hint ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">SLA due</dt>
                  <dd><SlaCountdown dueAt={detail.data.appeal.sla_due_at} /></dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">PII flagged</dt>
                  <dd>{detail.data.appeal.pii_flagged ? "yes" : "no"}</dd>
                </div>
              </dl>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-sm font-medium">Free text</div>
                  {detail.data.appeal.pii_flagged && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setUnredact((u) => !u)}
                      className="h-7 gap-1 text-xs"
                    >
                      {unredact ? <><EyeOff className="h-3 w-3" /> Re-redact</> : <><Eye className="h-3 w-3" /> Unredact</>}
                    </Button>
                  )}
                </div>
                <div className="rounded-md border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                  {detail.data.appeal.free_text ?? <span className="text-muted-foreground italic">(no free text)</span>}
                </div>
              </div>

              {(detail.data.appeal.status === "open" || detail.data.appeal.status === "in_review") && (
                <form
                  className="space-y-3 border-t pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!selected) return;
                    resolveMutation.mutate({ appealId: selected, ...form });
                  }}
                >
                  <Input
                    placeholder="Reviewer name (required)"
                    value={form.reviewer}
                    onChange={(e) => setForm((f) => ({ ...f, reviewer: e.target.value }))}
                    required
                    minLength={2}
                  />
                  <Textarea
                    placeholder="Resolution (at least 10 chars)"
                    value={form.resolution}
                    onChange={(e) => setForm((f) => ({ ...f, resolution: e.target.value }))}
                    required
                    minLength={10}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="submit"
                      disabled={resolveMutation.isPending}
                      onClick={() => setForm((f) => ({ ...f, outcome: "resolved" }))}
                    >
                      Resolve
                    </Button>
                    <Button
                      type="submit"
                      variant="destructive"
                      disabled={resolveMutation.isPending}
                      onClick={() => setForm((f) => ({ ...f, outcome: "rejected" }))}
                    >
                      Reject
                    </Button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="text-sm text-destructive">Failed to load detail.</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
