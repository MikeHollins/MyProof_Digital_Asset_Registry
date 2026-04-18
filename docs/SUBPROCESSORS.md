# Subprocessor List

Per GDPR Art. 28(2) and Art. 30(2), the following subprocessors process data on behalf of MyProof. This list is updated when subprocessors change. Merchants and regulators are notified per the DPA signed with each merchant.

## Infrastructure subprocessors

| Subprocessor | Purpose | Data region | Transfer mechanism | DPA |
|---|---|---|---|---|
| **Vercel, Inc.** (US) | Application hosting (serverless functions + edge) | US (us-east-1), EU (fra1) | EU–US DPF + SCCs Module 2 (when EU data is processed in US) | [vercel.com/legal/dpa](https://vercel.com/legal/dpa) |
| **Neon Inc.** (US) | PostgreSQL managed database (policies, audit events, epoch roots, verifications, appeals) | US (us-east-2), EU (eu-central-1 when Phase 5 EU project lands) | SCCs Module 2 + SOC 2 Type II | [neon.com/dpa](https://neon.com/dpa) |
| **Amazon Web Services, Inc.** (US) | KMS signing key (dual-region Multi-Region Key) + Cloudflare R2 backup equivalent | us-east-1 + eu-central-1 | SCCs Module 2 + EU–US DPF | [aws.amazon.com/compliance/gdpr-center/](https://aws.amazon.com/compliance/gdpr-center/) |
| **Cloudflare, Inc.** (US) | R2 object storage (WORM epoch backups) | Global + EU | SCCs Module 2 + EU–US DPF | [cloudflare.com/en-gb/dpa](https://cloudflare.com/en-gb/dpa) |
| **GitHub, Inc.** (US, Microsoft subsidiary) | Source control, SBOM, Dependabot, SAST | US | Microsoft EU Data Boundary for code, SCCs for others | [docs.github.com/en/site-policy/privacy-policies/github-data-protection-agreement](https://docs.github.com/en/site-policy/privacy-policies/github-data-protection-agreement) |

## Security / compliance subprocessors

| Subprocessor | Purpose | Data region | Transfer mechanism |
|---|---|---|---|
| **Sigstore (Linux Foundation)** | Public transparency log (Rekor v1/v2) + free RFC 3161 TSA. Processes only epoch root hashes — no personal data. | Global public log | No transfer of personal data |
| **FreeTSA.org** (Germany) | Free RFC 3161 qualified-timestamp fallback. Processes only epoch root hashes. | EU | No transfer of personal data |
| **DigiCert / QuoVadis** (future, Phase 5+) | eIDAS-qualified RFC 3161 timestamps for EU market | EU | N/A — no personal data |
| **ICAO PKD** (Montréal, Canada) | Country Signing CA trust anchors for passport Passive Authentication. Downloaded master lists only — no data transmitted. | N/A (download-only) | No transfer of personal data |
| **AAMVA Digital Trust Service (DTS)** (US) | VICAL (Verified Issuer Certificate Authority List) for US mDL. Downloaded only — no data transmitted. | N/A (download-only) | No transfer of personal data |
| **Prighter (EU)** (future, Phase 5+) | GDPR Art. 27 Representative | EU | Direct — Prighter is the EU-based representative |

## Regulators + certifications

Not subprocessors, but MyProof interacts with:

| Entity | Interaction |
|---|---|
| **CNIL** (FR data protection authority) | Notification of deployment + appeals statistics under EDPB Statement 1/2025 |
| **ARCOM** (FR audiovisual regulator) | Compliance with référentiel technique (9 octobre 2024) |
| **Ofcom** (UK) | Highly effective age assurance guidance (Jan 2025) |
| **U.S. Federal Trade Commission** | General consumer protection |
| **ICO** (UK data protection) | Joint guidance with Ofcom |

## Change procedure

When a subprocessor is added or removed:

1. This document is updated in the same commit that adds/removes the integration
2. Merchants with active contracts are notified via webhook within 30 days
3. Regulators who have requested change notification are emailed by the DPO
4. The public `/transparency` page reflects the change within 24 hours

## Attestations on file

- Neon SOC 2 Type II report (on file, available on request under NDA)
- AWS SOC 2 / SOC 3 / ISO 27001 (public)
- Vercel SOC 2 Type II (on file, available on request under NDA)
- MyProof's own SOC 2 (in progress — target Q3 2026)

## Last updated

2026-04-18. Review cadence: quarterly or at subprocessor change.
