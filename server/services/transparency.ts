import { db } from "../db";
import { auditEvents } from "../../shared/schema";
import { desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { jcs } from "../plugins/canonicalize";

type AuditEventType = 'MINT' | 'USE' | 'TRANSFER' | 'STATUS_UPDATE';

/**
 * Append an audit event to the transparency log
 * Creates hash-chained immutable audit trail
 */
export async function appendAudit(evt: {
  event_type: AuditEventType;
  asset_id?: string;
  payload: Record<string, unknown>;
  trace_id?: string;
}) {
  // Get the previous event's hash for chain linking
  const prevEvents = await db
    .select()
    .from(auditEvents)
    .orderBy(desc(auditEvents.timestamp))
    .limit(1);

  const previousHash = prevEvents.length > 0 ? prevEvents[0].eventHash : null;

  // Canonicalize payload and create event hash
  const canonicalPayload = jcs(evt.payload);
  const eventData = {
    event_type: evt.event_type,
    asset_id: evt.asset_id || null,
    payload: canonicalPayload,
    previous_hash: previousHash,
    timestamp: new Date().toISOString(),
  };

  const eventHash = createHash("sha256")
    .update(jcs(eventData))
    .digest("hex");

  const result = await db
    .insert(auditEvents)
    .values({
      eventType: evt.event_type,
      assetId: evt.asset_id || null,
      payload: evt.payload,
      traceId: evt.trace_id || null,
      previousHash,
      eventHash,
      timestamp: new Date(),
    })
    .returning({ eventId: auditEvents.eventId });

  return result[0]?.eventId || null;
}

/**
 * Get audit events for a specific asset
 */
export async function getAuditEvents(assetId: string) {
  return db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.assetId, assetId))
    .orderBy(desc(auditEvents.timestamp));
}
