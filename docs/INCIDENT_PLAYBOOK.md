# Incident Response Playbook

Single authoritative source for incident triage, notification, and remediation. Organized by incident type. Every response path names a specific owner, time budget, and regulatory notification obligation.

**Escalation tree:** Triage engineer → Incident commander → (if regulatory) DPO → (if press) CEO

---

## Regulatory notification timelines (absolute deadlines)

| Regime | Deadline | Triggers |
|---|---|---|
| **GDPR Art. 33** | **72 hours** from awareness | Personal data breach likely to result in risk to data subject rights |
| **NIS2 Art. 23** | **24 hours** early warning + 72h full notification | "Significant incident" affecting essential-entity service continuity |
| **ARCOM (FR)** | **Immediate** | Compromise of French AV system |
| **eIDAS 2.0 QTSP rules** | **24 hours** to supervisory body | Compromise of qualified trust service (when we operate one) |
| **FTC (US)** | Varies by state; California CCPA 45 days | Applicable state consumer-protection laws |
| **ICO (UK)** | **72 hours** | Same as GDPR |
| **CCPA (CA)** | **45 days** to attorney general + affected residents | Unauthorized access to personal information |

---

## Incident categories + playbooks

### Category A — PII exfiltration from server

**Definition:** Any server log, database record, or response body demonstrated to contain raw PII (name, DOB, address, document number, portrait, MRZ). This is the highest-severity class under our PII invariant (§26a).

**Detection:**
- CI PII pattern scanner blocks deploy (pre-production)
- Production log-drain scanner alerts (post-production)
- External pentest report
- User report via `security@myproof.ai`

**Response (hour-by-hour):**

**H+0 — Triage (first 30 min)**
- Incident commander declared
- Freeze deploys on all branches
- Snapshot the logs + tables in question (forensic preservation)
- Determine scope: how many records, how many users, what fields

**H+1 — Containment**
- Rotate any potentially-compromised credentials
- Disable the affected code path via Vercel env var kill switch
- Redeploy with the redactor tightened

**H+4 — Assessment**
- Confirm PII leak via independent review
- Count affected data subjects
- Document root cause

**H+24 — Regulatory notification (GDPR deadline -48h)**
- DPO notifies EU supervisory authorities (CNIL + any member state with affected residents)
- If NIS2 applies: 24-hour early warning already sent
- If French AV market: ARCOM notified immediately

**H+72 — Full GDPR notification**
- Formal written notification with: nature of breach, categories + approximate number of data subjects, likely consequences, mitigations, DPO contact

**H+30 days — Affected data subject notification (if required)**
- Direct notice to affected subjects per Art. 34 if risk to rights is high
- Public disclosure on `/transparency/incidents` page

### Category B — Credential / API key compromise

**Definition:** Admin API key, AWS KMS key, policy signing key, or merchant API key exposed.

**Response:**
- **Within 1 hour:** Revoke the compromised credential. Rotate all credentials of the same class as precaution.
- **Within 24 hours:** Review audit logs for activity performed with the compromised credential. Reverse any unauthorized changes (policy signings, key rotations).
- **Within 72 hours:** If personal data was accessed, GDPR notification. Otherwise, NIS2 24-hour early warning applies.
- **Post-mortem:** within 14 days, published to `/transparency/incidents`.

### Category C — STARK verification failure (fraud)

**Definition:** A STARK proof passes MyProof verification but is later shown to be forged (e.g., via a circuit soundness break).

**Response:**
- **Within 1 hour:** Disable the affected circuit version via `circuit_versions.deprecated_at`
- **Within 4 hours:** Identify all proof assets signed with the affected circuit
- **Within 24 hours:** Notify affected merchants via webhook
- **Within 72 hours:** Public disclosure + patched circuit shipped
- **Post-mortem + retraining:** within 14 days

### Category D — Cryptographic library vulnerability (e.g., Ed25519, SHA-256, RISC Zero)

**Response:**
- Patch upstream library + rebuild all signers within 24 hours
- Rotate all signing keys
- Re-verify all epoch roots signed with the old version
- If soundness affected: treat as Category C

### Category E — Regulatory enforcement action (CNIL, ARCOM, Ofcom, FTC)

**Response:**
- Acknowledge receipt within regulator's stated deadline (usually 14 days)
- DPO + legal counsel coordinate written response
- If injunction: comply immediately, fix root cause in parallel
- Publish the outcome (with regulator's approval) on `/transparency`

### Category F — Supply-chain compromise (npm / cargo dependency)

**Definition:** A dependency in our SBOM is found to contain malicious code.

**Response:**
- Within 1 hour: pin to known-safe version or replace dependency
- Within 24 hours: rebuild + redeploy all services
- Within 72 hours: audit artifacts produced during the compromise window
- Publish CVE attribution + our patch commit to `/transparency/incidents`

### Category G — DoS / rate-limit exhaustion

**Response:**
- Enable Vercel Attack Challenge Mode (WAF)
- Tighten per-IP rate limits
- Scale up function allocation temporarily
- Post-mortem within 7 days; no regulator notification required unless essential-entity under NIS2

### Category H — Insider threat / rogue admin

**Response:**
- Incident commander acts under emergency-admin powers (independent pathway)
- Freeze the suspect account
- Preserve forensic evidence (KMS CloudTrail + PAR audit events)
- Within 24 hours: escalate to law enforcement if criminal
- Report to regulators per applicable regime

---

## Notification templates

### GDPR Art. 33 notification template

```
To: [supervisory authority]
Subject: Personal Data Breach Notification — MyProof

1. Nature of the breach: [description]
2. Categories of data subjects affected: [e.g., French residents attempting age verification]
3. Approximate number of records: [N]
4. Categories of personal data: [e.g., none stored, but inference from hashes possible under conditions X]
5. Consequences: [likely risk]
6. Mitigations: [immediate + planned]
7. DPO contact: dpo@myproof.ai

Ref incident ID: MYP-INC-YYYY-MM-DD-NNN
```

### NIS2 24-hour early warning template

```
To: national CSIRT
Subject: NIS2 Significant Incident Early Warning

Entity: MyProof (age verification / identity service)
Detected at: [timestamp UTC]
Incident category: [A–H]
Preliminary impact assessment: [service availability / data / reputation]
Cross-border implications: [yes/no]
Full notification by: [H+72]

Contact: security@myproof.ai
Ref: MYP-INC-YYYY-MM-DD-NNN
```

### ARCOM notification template (French AV market)

```
À: ARCOM
Objet: Incident système de vérification d'âge — MyProof

Description: [français]
Impact utilisateurs: [nombre approximatif]
Mesures immédiates: [actions déjà prises]
Mesures prévues: [plan de remédiation + délais]
Contact: dpo@myproof.ai, +1-XXX-XXX-XXXX

Référence: MYP-INC-YYYY-MM-DD-NNN
```

---

## Post-incident review (every incident)

Within 14 days:

1. Root cause analysis (5-whys + fault tree)
2. Contributing factors (process, tooling, human)
3. Regulator liaison outcome
4. Remediation verification
5. Policy / playbook updates
6. Public write-up (redacted) on `/transparency/incidents`

---

## Contact directory

- **Incident commander on duty:** see `ops/oncall-rotation.md` (to be added)
- **DPO:** dpo@myproof.ai
- **Legal counsel:** [outside counsel on retainer — to be added]
- **Security inbox:** security@myproof.ai
- **Bug bounty / responsible disclosure:** security@myproof.ai with PGP key published at `/.well-known/security.txt`

---

## Last updated

2026-04-18. Review cadence: quarterly + after every incident.
