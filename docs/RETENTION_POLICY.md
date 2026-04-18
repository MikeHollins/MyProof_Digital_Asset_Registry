# Data Retention Policy

GDPR Art. 5(1)(e) storage limitation — data kept no longer than necessary for the purposes for which it is processed. This document is the canonical authority.

## Retention table

| Data category | Location | Retention | Justification |
|---|---|---|---|
| **Raw PII** (name, DOB, portrait, MRZ, document number) | User device only | User-controlled (uninstall = deletion) | Never leaves device (Phase 1 PII invariant). Nothing to retain. |
| **Cryptographic commitments** (doc_commitment, face_event_hash, identity_commitment) | `proof_assets`, `audit_events`, `epoch_roots` | **7 years** | Regulatory audit trail per eIDAS 2.0 + ARCOM (6 years + current calendar year). |
| **Verifications log** (merchant, verdict, request_id) | `verifications` | **13 months** | GDPR minimum for operational fraud detection; longer retention would require specific legitimate interest case. |
| **Server access logs** (IP, request path, status code) | Vercel / SIEM | **90 days** | Operational investigation window. Auto-purged. |
| **Error logs** (exceptions, redacted) | Same | **90 days** | Same. |
| **Debug logs** (DEBUG_MERCHANT=true, DEBUG_NONCE=true) | Dev only — never enabled in production | **24 hours max if ever enabled** | Debug flags are gated to non-production environments. |
| **Appeals** (category, free_text, resolution) | `appeals` | **3 years** | Art. 22 GDPR human-review obligation + dispute statute of limitations in multiple jurisdictions. |
| **API keys** (partner secrets, hashed) | `api_keys` | Until revoked + 90 days | Revoked keys retain hash for 90 days to detect reuse attempts. |
| **Status list state** (bitstring) | `status_lists` | **7 years** (matches `proof_assets`) | W3C Status List semantics require historical lookups. |
| **Circuit versions** | `circuit_versions` | **Forever** | Old circuit versions must remain verifiable for every proof ever signed with them. Retired circuits are marked `deprecated_at` but the row stays. |
| **Policies** | `policies` | **Forever** (with `deprecated_at` marker) | Same rationale as circuits. |
| **Epoch root anchors** (Merkle roots, signatures, TSA tokens) | `epoch_roots` + Rekor + R2 + TSA issuer logs | **Forever (public transparency log)** | Purpose of a transparency log is permanence. |

## Right to erasure interaction (GDPR Art. 17)

Cryptographic commitments are **not personal data** per GDPR Art. 4(1) — they cannot be linked to a natural person without the user's private keying material held on their device. When a user invokes Art. 17:

- We acknowledge the request within 72 hours
- We confirm that nothing stored on our infrastructure constitutes their personal data
- We log the acknowledgement
- We take no further action — there is nothing to erase because nothing identifying them is in our systems

This framing is reaffirmed by EDPB's blockchain-adjacent guidance (Berlin Group WP, 2019; 2024 reaffirmation).

If a user's private keying material still exists on their device, they can delete the App Clip. Once deleted, no path exists from the commitments in our ledger back to them — even for us.

## Automated enforcement

- Server access logs — Vercel auto-purges at 90 days (Pro tier retention setting)
- Verifications — nightly cron `DELETE FROM verifications WHERE created_at < NOW() - INTERVAL '13 months'` (to be deployed Phase 5+)
- Appeals — same pattern, 3 years
- Debug logs — only enabled in non-production; auto-purged by sink provider

## Tamper evidence for retention

A regulator can request a signed attestation that retention has been enforced. The SHA-256 of the purged-rows manifest is committed to the next epoch root. Verifiers can replay the proof that a claimed deletion actually happened.

## Last reviewed

2026-04-18. Review cadence: semiannually.
