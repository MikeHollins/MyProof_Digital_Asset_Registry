# Data Protection Impact Assessment — MyProof

Per GDPR Art. 35 + EDPB Statement 1/2025 on Age Assurance (11 Feb 2025, binding guidance).

Age verification triggers the DPIA requirement because it involves **systematic monitoring on a large scale** + **vulnerable data subjects (children/minors)** + **innovative technology (ZK STARK proofs)** — the Art. 35(3) triple trigger.

This document is updated with each major architectural change.

---

## 1. Processing description

**Processing purpose:** Determine whether a natural person's age (or other policy-encoded attribute) meets a merchant's policy requirement, without disclosing the attribute value to the merchant.

**Categories of data subjects:** Adults seeking age-gated services; prospective customers of MyProof partners (bars, dispensaries, banks, French adult-content platforms).

**Categories of data processed:**
- Document data (name, DOB, address, document number, portrait) — processed **on device only**; never transmitted to MyProof infrastructure
- Face image (liveness check) — processed **on device only**; hash-commitment transmitted
- Device attestation (App Attest, DeviceCheck) — opaque binary transmitted
- IP address — received by Vercel edge, redacted before entering MyProof logs, retained in Vercel infrastructure for 90 days per Vercel policy

**Categories of recipients:**
- MyProof infrastructure (server + DB) — receives only commitments + signatures + boolean predicates
- Merchant (partner) — receives only `{verdict: pass|fail, assurance_level}`
- External transparency anchors (Sigstore Rekor, RFC 3161 TSAs) — receive only epoch root hashes (aggregate, no individual data)

**Retention:** Per `docs/RETENTION_POLICY.md`.

---

## 2. Necessity + proportionality assessment

| Data type | Necessity for purpose | Proportionality |
|---|---|---|
| DOB | YES — required to compute `age_over_N` predicate | MINIMIZED — only on device; only predicate leaves device |
| Face | YES — required for liveness (anti-spoof) | MINIMIZED — only hash commitment; no template retained |
| Document portrait | YES — required to bind face to document | MINIMIZED — only hash + match-bucket |
| Document number | NO — not required after on-device parse | NOT TRANSMITTED |
| Address | NO — not required | NOT TRANSMITTED |
| Name | NO — not required | NOT TRANSMITTED |
| IP address | LIMITED — needed for DDoS + rate limiting | Redacted from persistent logs; Vercel retention 90 days |

**Data minimization assessment:** PII invariant is architecturally enforced (zod allowlist + CI scanner + log redactor). The system **cannot** process PII even if a future code change attempts to.

---

## 3. Rights of data subjects

| Right | Implementation |
|---|---|
| **Art. 13/14 — Information** | Privacy notice + Art. 50 AI Act disclosure in App Clip onboarding |
| **Art. 15 — Access** | No personal data to disclose because none is stored |
| **Art. 16 — Rectification** | Not applicable — commitments cannot be rectified without re-scanning the document |
| **Art. 17 — Erasure** | User deletes App Clip → zeroizes keying material; ledger retains only non-PII commitments. See `RETENTION_POLICY.md`. |
| **Art. 18 — Restriction** | Not applicable — no profile maintained |
| **Art. 20 — Portability** | App Clip export function (Phase 6) returns user's local attestation bundle |
| **Art. 21 — Objection** | Rejection path: user can withhold proof. Appeal path exists for incorrect rejections |
| **Art. 22 — Automated decision-making + human review** | Every rejection surfaces `/api/appeal` link. 30-day SLA. Reviewer queue operational from Phase 3. |

---

## 4. Risk assessment

### High risks evaluated

| Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|
| PII leaks via server misconfiguration | Very low | High | PII invariant (§26a): zod allowlist + log redactor + CI scanner + PR checklist. Four-layer defense. |
| Proof replay across merchants | Low | Medium | Session nonce binding + per-merchant `merchant_id_hash` + one-time-use semantics per policy |
| CSCA trust store compromise | Low | High | ICAO PKD + multiple national master lists + nightly sync; log-on-mismatch alerting |
| Spoofing (3D mask, deepfake) | Medium | Medium | Depth sensor (TrueDepth) + challenge-response liveness + ISO/IEC 30107-3 PAD methodology |
| Unlinkability failure across presentations | Medium | Medium | Per-session ephemeral commitments; batch-issued single-use tokens for EUDI interop (Phase 4 emitters) |
| Admin account compromise | Low | High | Hardware MFA; separate accounts per role; 24h delay-lock on policy changes; audit of admin actions |
| Compelled disclosure (subpoena) | Medium | Medium | Nothing to disclose — no PII retained |
| Incorrect rejection harming user | Medium | Low–Medium | Art. 22 appeal path with 30-day SLA + human review |
| AI Act reclassification (liveness) | Low | Medium | Compliance readiness plan in `AI_ACT_CONFORMITY_MEMO.md` — 4-8 week conversion if needed |

### Residual risks

After all mitigations, residual risk is **LOW** across all categories. This is consistent with EDPB Statement 1/2025's "privacy-preserving age verification" guidance.

---

## 5. Consultation

- [x] Engineering review (this document)
- [x] Compliance review (in progress, ongoing)
- [ ] **Legal counsel review** — scheduled before EU production launch
- [ ] **CNIL pre-consultation** — optional but recommended for French adult-content launch
- [ ] **ARCOM submission** — required for French adult-content certification; scheduled

---

## 6. Review cadence

- At launch
- At every major architectural change
- Annually thereafter
- Upon regulator guidance changes (AI Act high-risk guidance, EDPB updates)

## 7. Monitoring KPIs

- PII leak incidents: **0 tolerance**
- Appeal resolution SLA adherence: **>= 95% within 30 days**
- Spoof detection FAR: **< 5%** (iBeta Level 2 target when certified)
- Spoof detection FRR: **< 5%**

---

**Last updated:** 2026-04-18
**Next scheduled review:** 2026-07-18 (quarterly) or upon Commission AI Act guidance publication
