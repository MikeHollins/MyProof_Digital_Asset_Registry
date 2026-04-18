# AVP ↔ Verifier Architectural Split

## Why

French CNIL's "double anonymity" guidance (2022) and ARCOM référentiel technique (9 October 2024) require that:

- The **age-verification provider (AVP)** cannot know where a user verified (which merchant)
- The **relying-party merchant** cannot know who the user is

MyProof's implementation achieves this by splitting the verification pipeline into two contractually and technically isolated roles.

## Roles

### AVP role — `avp.myproof.ai` (identity issuance)

- Receives doc scan, face capture, STARK proof from the App Clip
- Validates proof + derives internal trust level
- Returns a **blinded attestation token** the user can present to any merchant
- **NEVER** sees the merchant's identity
- Logs: user device signals, trust tier, doc_type, NFC fingerprints
- Does NOT log: merchant_id, session_id tied to merchant, Referer, redirect URL

### Verifier role — `verify.myproof.ai` (merchant callback)

- Receives the blinded attestation token from the user (via the merchant's site)
- Decodes the token (server-held unblinding key)
- Returns `{verdict: pass|fail, assurance_level: "maximum"}` to the merchant
- **NEVER** sees raw user-identifying signals (DOB, face_event_hash, CSCA fingerprint)
- Logs: merchant_id, request_id, verdict, latency
- Does NOT log: user device id, trust tier detail, NFC fingerprints

### Contractual firewall

- Data Processing Agreement (DPA) between AVP-role entity and verifier-role entity
- Neither role has read access to the other's log stream
- Separate Vercel projects, separate Neon DB schemas/roles
- Separate AWS KMS signing keys
- Quarterly independent audit of log contents

## Phase 3 status (this phase)

- [x] **Schema** — `verifications` + `appeals` tables carry the merchant-role fields (no user device signals)
- [x] **Appeals endpoint** (Art. 22 EDPB Statement 1/2025) — structured form, PII scanner, 30-day SLA
- [x] **Trust-level enforcement** (Phase 1 already wired) — hard-fails proofs below policy min
- [x] **Predicate-only credential emission** (Phase 1 allowlist already enforces)
- [ ] **Dual-host deployment** — requires two separate Vercel projects; scheduled for Phase 9 (cutover). Until then, both roles run on a single codebase with logical log separation and DB role separation.

## Phase 9 cutover checklist

When cutover happens:

1. Create `avp-myproof` Vercel project with hostname `avp.myproof.ai`. Deploy the `avp` role only.
2. Create `verify-myproof` Vercel project with hostname `verify.myproof.ai`. Deploy the `verify` role only.
3. Each project has its own Neon DB role with SELECT access scoped to its own schema:
   - AVP role: `auth_sessions`, `user_signals`, trust-level derivation tables
   - Verifier role: `verifications`, `appeals`, `proof_assets`
4. AWS KMS signing key split: one key for AVP, one for verifier. Neither role can sign for the other.
5. Log drains configured to separate sinks (Vercel → Cloudwatch → different S3 buckets with different IAM).
6. App Clip update (already in Phase 6 plan) switches base URL from `myproof.ai` to `avp.myproof.ai`.
7. Website integration docs for merchants switch `POST` target to `verify.myproof.ai`.
8. Legal: DPA between entities signed. Public disclosure on `/transparency` page.

## Phase 3 code contract (what lives where today)

| Concern | Phase 3 location | Phase 9 location |
|---|---|---|
| STARK proof validation | myproof-website proof-submit endpoint | AVP role — unchanged |
| Trust-level derivation (from NFC fingerprints) | trust-deriver.ts on verify host | AVP role — unchanged |
| Policy lookup + min_trust_level enforcement | proof-submit endpoint (shared today) | AVP role (performs) → verifier role (displays verdict) |
| Merchant verdict delivery | proof-submit response | Verifier role |
| Appeals endpoint | `/api/appeal` on PAR | Verifier role (gets the user-facing URL) |
| Transparency endpoints | `/api/transparency/*` on PAR | Both roles reference same public ledger |
| Audit ledger + epoch roots | PAR registry | Unchanged (neutral signer) |

## Invariants that never cross the split

These invariants from Phase 1 apply to BOTH roles equally (no PII on either side):

- Only commitments, booleans, enums, predicates, signatures leave the App Clip
- Log redactor middleware strips PII from all outbound logging
- SD-JWT-VC / mdoc / OpenID4VP presentations emit only predicate claims

## References

- CNIL 2022 online age-verification guidance (French original)
- ARCOM référentiel technique (JORF TEXT000050385836, 9 octobre 2024)
- EDPB Statement 1/2025 on Age Assurance (February 2025)
- Phase 1 PII invariant: `.agents/phase-gates/phase-1.md`
