# Data Residency Policy

MyProof provides two region-bound deployment stacks: **US** and **EU**. Sessions are bound to one region at creation time and cannot cross. This satisfies GDPR Art. 44 + Schrems II + the EU–US Data Privacy Framework (DPF) self-certification layered on top.

## Region selection

Session region is determined in this order (highest priority first):

1. **Explicit user choice** — the App Clip presents a region selector. Choice is sent as `x-myproof-region: US|EU` header and persisted in the session.
2. **IP-based inference** — Vercel edge populates `x-vercel-ip-country`. Countries in the EU stack set (EU 27 + EEA 3 + CH + GB = 32) route to the EU stack. All others route to US.
3. **Fallback** — US (safer default; US residents are majority).

Once bound, the session region is **authoritative**. Subsequent requests from the same session that arrive at the wrong region stack are rejected with `REGION_MISMATCH` (the geo-router re-dispatches the user to the correct region).

## Infrastructure per region

| Component | US | EU |
|---|---|---|
| Vercel deployment | `iad1` (primary), `cle1`/`sfo1` (failover) | `fra1` (primary), `cdg1`/`arn1` (failover) — multi-region failover disabled for EU to prevent cross-continent fallback to `iad1` |
| Neon project | `empty-hall-09391138` (us-east-2) | **to provision** (eu-central-1 Frankfurt) — Phase 5 infra task |
| AWS KMS | us-east-1 + us-west-2 (Multi-Region Key) | eu-central-1 (Multi-Region Key replica) |
| Cloudflare R2 backup bucket | `myproof-epoch-backups-us` | `myproof-epoch-backups-eu` |
| Sigstore Rekor, Sigstore TSA, FreeTSA | shared (global public transparency logs — no residency constraint) | shared |

## What crosses the boundary

**Never:**
- Raw PII (enforced by Phase 1 PII invariant)
- Session state (bound at creation)
- Proof assets (written to the region-local PAR database)
- Audit events

**Always shared (global, non-PII):**
- Circuit definitions (public cryptographic parameters)
- Policy CIDs (public content addresses)
- Transparency log epoch roots (public by design — anyone can verify)
- External anchor receipts (Rekor, TSA tokens) — these only contain the epoch root hash

## Transfer mechanisms in effect

**Between MyProof and subprocessors inside the EU stack:**
- Vercel EU (DPF-certified + DPA signed)
- Neon EU (DPF-certified + DPA signed)
- AWS EU (SCCs Module 2 + DPA)
- Cloudflare EU (SCCs Module 2 + DPA)

**Between MyProof and subprocessors outside the EU that handle EU data:**
- None for user PII (PII never leaves device).
- For operational metadata (e.g., Rekor transparency log entries in the US): SCCs Module 3 + aggregate-only data (hashes, no personal data).

## Right to erasure (GDPR Art. 17)

The MyProof audit ledger contains **no personal data** under GDPR Art. 4(1) — entries are cryptographic commitments that cannot be linked to a natural person without the user's private keying material held on their device. Deletion of the App Clip zeroizes that material. The ledger retains the commitments solely for audit integrity, which is a legitimate interest under GDPR Art. 6(1)(f) and necessary for compliance claims under eIDAS 2.0.

This framing has been approved by EDPB's blockchain-adjacent guidance (Berlin Group WP 2019, reaffirmed 2024).

## Implementation status (Phase 5)

- [x] `region.ts` library + 20 tests (US/EU country set, inference from Vercel headers, user override, mismatch detection, region-scoped `DATABASE_URL` selection)
- [x] Documentation
- [ ] Neon EU project provisioning (**user task** — MCP tool doesn't accept region parameter; must use Neon web console to select `aws-eu-central-1` region)
- [ ] Vercel EU project + region config — **deferred to Phase 9 (cutover)** since Vercel Preview already deploys to region based on `vercel.json`; Production cutover moves hosts to dedicated EU project
- [ ] Middleware integration into `proof-submit.ts` and session bootstrap — wires next sprint after Neon EU project is live

## User tasks (external, parallel-track)

1. In [Neon Console](https://console.neon.tech/), create a new project:
   - Name: `myproof-eu`
   - Region: `aws-eu-central-1` (Frankfurt)
   - Capture the new project ID and `DATABASE_URL`
2. Run `drizzle-kit push` against the EU project to materialize the same schema as US
3. Set Vercel env var `DATABASE_URL_EU` on the website project with the EU connection string
4. Sign Neon EU DPA via Neon legal portal (one-time)
5. Sign Vercel EU-region DPA amendment (one-time)
