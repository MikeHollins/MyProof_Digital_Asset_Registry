# Proof-Asset Registry (PAR)

## Overview

The Proof-Asset Registry (PAR) is a privacy-first, enterprise-grade platform for secure registration, verification, and lifecycle management of cryptographic proofs. It supports various proof types, including zero-knowledge proofs and JSON Web Signatures, by emphasizing data minimization, content-addressable immutability using CIDs, W3C-compliant credential status tracking, and append-only audit transparency. PAR aims to provide a trusted registry for verifiers, issuers, and relying parties to manage proof assets, track their verification status, and maintain a complete audit trail.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

**Application Structure**: The project uses a monorepo structure with `client/` (React/Vite frontend), `server/` (Express.js backend), and `shared/` (TypeScript schemas/types).

**Frontend Architecture**:
- **Stack**: React 18, TypeScript, Vite, Wouter for routing, TanStack Query for server state.
- **UI**: Radix UI primitives, shadcn/ui (new-york style), Tailwind CSS, IBM Plex Sans/Mono fonts.
- **Design Philosophy**: Emphasizes precision, monospace fonts for technical identifiers, and clear hierarchy.
- **State Management**: Primarily TanStack Query for server state; local component state for UI.

**Backend Architecture**:
- **Framework**: Express.js with TypeScript on Node.js 20+.
- **API Design**: RESTful JSON API under `/api/*`, with logging and raw body capture.
- **Core Endpoints**: CRUD for proof assets, audit events, status lists, and system health.
- **Data Storage**: Currently in-memory (`MemStorage`) for development, with a planned migration to PostgreSQL via Neon serverless and Drizzle ORM.
- **Privacy-First Design**:
    - **Zero PII**: No personally identifiable information is stored.
    - **Content Addressability**: Uses CIDv1 for referencing policies, constraints, etc.
    - **Cryptographic Commitments**: Proof assets identified by deterministic commitments.
    - **Audit Transparency**: Cryptographically hash-chained audit events for all state changes.

**Database Schema (PostgreSQL + Drizzle ORM)**:
- `proof_assets`: Stores cryptographic proofs with strict privacy, unique commitment, and relevant indexes.
- `audit_events`: Append-only transparency log with hash-chaining.
- `status_lists`: W3C Bitstring Status List registry with ETag support.

**Data Flow & Verification Pipeline**:

### 1. Proof Registration (with Receipt Generation)
- Client submits proof metadata (issuer DID, proof format, digest, policy CID, etc.)
- Server generates commitment hash from proof data
- Proof verification executed (JWS signature validation, ZK proof verification stub)
- **Receipt Generation**: After successful verification, generates signed JWS receipt binding:
  - `proof_digest`: SHA-256 digest of proof bytes
  - `policy_hash`: Hash of policy constraints
  - `constraint_hash`: Hash of verification constraints
  - `status_ref`: W3C Status List reference (URL + index + purpose)
  - `jti`: Unique JWT ID for replay protection
  - `aud`, `nbf`, `exp`: Required JWT claims for security
- Receipt stored in `verifier_proof_ref` field (only the receipt, not the proof bytes!)
- Status list allocation (assigns index in revocation/suspension bitstring)
- Atomic write to storage with audit event creation
- Response includes verification result, assigned IDs, status references, and receipt

### 2. Receipt-Based Re-Verification (Fast Path)
- **Privacy-First Design**: Re-verification uses only the signed receipt, never requires original proof bytes
- Verification steps:
  1. **Receipt Signature Verification**: Validate JWS signature using verifier's public key
  2. **Algorithm & Header Validation**: Enforce ES256 allow-list, validate `typ:JWT`, reject `crit` headers
  3. **JWT Claims Validation**: Verify `aud`, `nbf`, `exp` with ±60s clock skew, check `jti` replay cache
  4. **Commitment Matching**: Verify proof_digest, policy_hash, constraint_hash match stored values (prevents substitution attacks)
  5. **Status Reference Matching**: Validate statusListUrl (normalized), statusListIndex, and statusPurpose match
  6. **Status List Check**: Validate proof not revoked/suspended via W3C Bitstring Status List
- **Benefits**:
  - Eliminates PII storage risk (no proof payload retained)
  - Fast verification (cryptographic operations only, no proof re-execution)
  - Tamper-evident (receipt signature + commitment binding)
  - Replay-resistant (jti-based deduplication)
- Updates verification timestamp and creates audit event

### 3. Receipt Cryptography & Security Model
- **Signing Algorithm**: ES256 (ECDSA P-256 with SHA-256)
- **Algorithm Allow-List**: Only ES256 permitted, explicitly rejects `alg:none` and unsupported algorithms
- **Key Management**:
  - Development: Keypair loaded from environment variables
  - Production: Separate Registry (public key only) and Verifier Service (private key in KMS/HSM) roles
- **Strict JWT Validation**:
  - `typ` header must be "JWT"
  - `alg` must be ES256 (allow-list enforcement)
  - `aud` (audience) required and validated
  - `nbf` (not before) and `exp` (expiry) enforced with ±60s clock skew tolerance
  - `jti` (JWT ID) checked against replay cache (10-minute TTL)
- **Security Properties**:
  - Non-repudiation, Integrity, Freshness, Binding, Replay Resistance, Clock Skew Tolerance

### 4. Status Management & Fail-Closed Security
- **W3C Bitstring Status List** pattern for efficient revocation/suspension
- **Fail-Closed Behavior** (Production): If status list unreachable or stale, verification fails closed
- **MVP Behavior**: Respects existing revoked/suspended status (fail-safe)
- **URL Normalization**: Status list URLs normalized before comparison
- **Status Reference Validation**: Receipt must match all three components

### 5. Digest Validation & Encoding
- **Algorithm Support**: sha2-256, sha3-256, blake3, multihash
- **Encoding Validation**: Digests must be hex-encoded with correct length
- **Persistence**: digestAlg stored alongside proofDigest

### 6. Audit Trail
- Every mutation creates a hash-chained audit event for integrity verification

### 7. Privacy-First Logging
- Sensitive data automatically redacted from logs
- Only opaque IDs, truncated hashes, statusVerdict, trace_id logged

## External Dependencies

**Required Services**:
- **PostgreSQL Database**: Via Neon serverless for production persistence.

**Third-Party Libraries**:
- **Frontend**: `@tanstack/react-query`, `@radix-ui/*`, `wouter`, `date-fns`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `react-hook-form`, `@hookform/resolvers`.
- **Backend**: `express`, `drizzle-orm`, `drizzle-zod`, `@neondatabase/serverless`, `ws`, `nanoid`.
- **Build Tools**: `vite`, `esbuild`, `tsx`, `tailwindcss`, `postcss`, `autoprefixer`.

**External APIs & Integrations (Future)**:
- ZK Proof Verification Services
- W3C Verifiable Credentials (status list hosting)
- IPFS/Content-Addressable Storage
- DID Resolvers
- OpenTelemetry Collectors

**Environment Variables**:
- `DATABASE_URL` - PostgreSQL connection string (auto-configured in Replit)
- `NODE_ENV` - Environment mode (development/production)
- `STATUS_BASE_URL` - Base URL for W3C Status Lists
- `STATUS_MAX_STALENESS_MS` - Max age for cached status lists (default: 24h)
- `STATUS_FETCH_TIMEOUT_MS` - Timeout for status list fetches (default: 3s)
- `REDIS_URL` - Optional Redis URL for replay cache (uses in-memory if not set)
- `RECEIPT_VERIFIER_PUBLIC_JWK` - Public JWK for receipt verification (ES256)
- `RECEIPT_VERIFIER_PRIVATE_JWK` - Private JWK for receipt signing (ES256, dev only)
- `PROOF_MAX_SIZE_BYTES` - Max proof payload size (default: 128KB)
- `PROOF_FETCH_TIMEOUT_MS` - Timeout for proof fetches (default: 3s)
- `PROOF_ALLOWED_HOSTS` - Comma-separated allowlist for proof URIs (production)