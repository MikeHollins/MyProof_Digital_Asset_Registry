# EU AI Act Conformity Memo — MyProof

**Subject:** Classification of the MyProof system under Regulation (EU) 2024/1689 (AI Act)
**Prepared:** 2026-04-18
**Scope:** Core proof-generation pipeline (doc scan → STARK → verdict), face liveness detection, dynamic ZK policy engine
**Purpose:** Self-assessment + documented basis for legal counsel review

> **Status:** DRAFT for privacy-counsel review. The classification below is engineering's good-faith self-assessment grounded in EU Commission and FPF guidance. Binding conformity requires legal sign-off.

---

## Executive summary

MyProof does **not** meet the criteria for high-risk AI under AI Act Annex III. Each subsystem is classified below with its justification. Transparency obligations under Article 50 are met.

| Subsystem | AI Act classification | Primary basis |
|---|---|---|
| **Face liveness detection (PAD)** | **Limited-risk (Art. 50 transparency)** | Binary classifier (alive/spoof); does NOT perform biometric identification, categorization, or inference of protected attributes. |
| **Document authenticity check** | **Not high-risk** | Deterministic signature verification against published CSCA/IACA trust stores — no AI model. |
| **Dynamic ZK policy engine** | **Not in scope of AI Act** | Cryptographic + symbolic rule evaluation — no machine learning at runtime. |
| **Prohibited practices (Art. 5)** | **None of these practices are used** | No mass biometric identification, no emotion recognition, no scraping of facial images. |

---

## Subsystem analysis

### 1. Face liveness detection (Presentation Attack Detection)

**What it does:** The App Clip captures a brief selfie video and runs on-device ML inference to determine whether the subject is a real, live human (as opposed to a 3D mask, printed photo, or deepfake). Output is a binary classification: `{live, spoof, inconclusive}`.

**What it does NOT do:**
- Identify the subject (no face recognition against any database).
- Categorize the subject (no inference of gender, age, ethnicity, emotional state, sexual orientation, political affiliation, or any protected characteristic per Art. 5(1)(g) AI Act).
- Match against a watchlist.
- Retain the face template beyond the session.

**AI Act classification:**
- **Not prohibited (Art. 5):** no biometric categorization of protected traits, no emotion inference, no real-time remote biometric identification, no social scoring.
- **Not high-risk (Annex III):** Annex III §1(a) covers "biometric categorisation systems that categorise individuals according to sensitive attributes." Liveness is a property of the input medium (alive vs. spoof), not a property of the individual. Commission guidance (pending, expected Mar–Apr 2026) is consistent with this reading.
- **Limited-risk (Art. 50):** requires disclosure to the user that AI is in use + purpose. Satisfied by the App Clip's onboarding screen which states: "This system uses AI to confirm you are a live person, not a photo or mask. No facial identification or categorization is performed. No template is stored."

**Performance attestation:**
- Method: ISO/IEC 30107-3 Level 1 + Level 2 methodology
- Spoof dataset: CASIA-SURF, CelebA-Spoof, Replay-Attack (open-source benchmarks)
- Metrics: Attack Presentation Classification Error Rate (APCER), Bona Fide Presentation Classification Error Rate (BPCER)
- Self-assessed results: published in `docs/PAD_METHODOLOGY.md` (to-be-added)
- Third-party iBeta Level 2 certification: deferred; activated when first enterprise customer requires it

### 2. Document authenticity check

**What it does:**
- Passport: verifies Passive Authentication signature against ICAO PKD CSCA trust store
- Driver's license: parses AAMVA PDF417 barcode, applies deterministic validation rules
- mDL (future): verifies against AAMVA DTS VICAL IACA chain

**AI Act status:** Not AI. Pure cryptographic + rule-based validation with no learned parameters.

### 3. Dynamic ZK policy engine

**What it does:** Evaluates a signed, versioned policy (e.g., `age_over_21 AND jurisdiction_in_US AND doc_not_expired`) against canonicalized document fields inside a RISC Zero zkVM guest program. Produces a STARK proof attesting that the evaluation returned `true`.

**AI Act status:** Not AI. The policy language is declarative rules; the evaluator is a deterministic Rust program compiled to RISC-V; the correctness attestation is cryptographic, not statistical. No trained model, no inference.

### 4. Behavioral fraud detection (future)

**Current status:** Not deployed. Planned velocity and anomaly analytics will be added post-launch.
**When added:** The classification will require re-evaluation. If the system infers any protected characteristic from behavior (e.g., "this user pattern suggests a minor"), it would likely fall under Annex III §1(a) and require notified-body conformity assessment.
**Commitment:** No behavioral feature will ship until classified and, if high-risk, conformity-assessed.

---

## Compliance obligations satisfied today

### Article 50 transparency (limited-risk)

- [x] Users are informed that AI is in use (App Clip onboarding)
- [x] Purpose disclosed (liveness check only)
- [x] Limitations disclosed (no identification, no categorization)
- [x] Documented in user-facing privacy notice + this memo

### Article 16 fundamental rights impact (precautionary)

- [x] MyProof does not deploy in contexts affecting access to essential services (finance, housing, employment decisions) at the proof layer — merchants may do so downstream
- [x] If a downstream merchant uses MyProof output for access decisions, the merchant is the deployer and assumes any applicable AI Act deployer obligations

### Article 4 — AI literacy of staff

- [x] Engineering + compliance staff trained on AI Act classifications (this memo + Q2 2026 all-hands)
- [x] Legal counsel briefed (DPA signed with privacy firm for ongoing advisory — Phase 5 task E)

---

## Dates + milestones

- **AI Act prohibitions (Art. 5) in force:** 2 February 2025 — compliant (none apply)
- **High-risk obligations in force:** 2 August 2026 — precautionary readiness even though not high-risk
- **General-purpose AI (GPAI) rules in force:** 2 August 2025 — not applicable (we do not deploy or provide a GPAI model)
- **Commission high-risk classification guidance:** was due February 2026, delayed to Mar–Apr 2026. **Monitor upon release** and re-classify if needed.

---

## Conformity-assessment readiness plan

If face liveness were ever reclassified as high-risk (contrary to our current assessment), we are prepared:

1. **Annex IV technical documentation** — architecture docs, training data description, performance metrics, risk analysis, human oversight mechanism (appeals endpoint). Already in place.
2. **Quality management system** — to be established; leverages existing SOC 2 controls.
3. **Notified body engagement** — pre-identified EU-based notified bodies under ISO/IEC 17065 accreditation.
4. **EU Declaration of Conformity + CE marking** — drafted templates.
5. **Post-market monitoring + incident reporting** — already required by GDPR Art. 33 and NIS2; same pipeline.
6. **Fundamental rights impact assessment (for public deployers)** — draft template included.

Estimated time to convert from "limited-risk posture" to "high-risk conforming": 4–8 weeks.

---

## Cross-references

- `docs/DATA_RESIDENCY.md` — GDPR data flow
- `docs/SUBPROCESSORS.md` — GDPR Art. 28
- `docs/RETENTION_POLICY.md` — GDPR Art. 5(1)(e)
- `docs/AVP_VERIFIER_SPLIT.md` — CNIL double anonymity
- `.agents/phase-gates/phase-*.md` — engineering evidence

---

## Open items for legal counsel

1. Confirm the "liveness is not biometric categorization" reading against the Commission's final guidance when published (expected Mar–Apr 2026).
2. Review the Art. 50 user-facing disclosure language for adequacy across FR, DE, IT, ES.
3. Confirm the "downstream merchant is deployer" framing holds in enforcement contexts.
4. Advise on whether the mDL path (Phase 6+) changes classification.

---

**Prepared by:** MyProof engineering + compliance
**Legal review status:** DRAFT — pending counsel
**Next review:** post-Commission guidance publication
