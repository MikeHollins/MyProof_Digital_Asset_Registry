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
- **Data Storage**: PostgreSQL via Neon serverless and Drizzle ORM. Demo system fully migrated from in-memory to database-backed persistence (October 2025).
- **Privacy-First Design**:
    - **Zero PII**: No personally identifiable information is stored.
    - **Content Addressability**: Uses CIDv1 for referencing policies, constraints, etc.
    - **Cryptographic Commitments**: Proof assets identified by deterministic commitments.
    - **Audit Transparency**: Cryptographically hash-chained audit events for all state changes.

**Database Schema (PostgreSQL + Drizzle ORM)**:
- `proof_assets`: Stores cryptographic proofs with strict privacy, unique commitment, and relevant indexes.
- `audit_events`: Append-only transparency log with hash-chaining.
- `status_lists`: W3C Bitstring Status List registry with ETag support (gzip-compressed, base64-encoded, optimistically locked).
- `jti_replay`: JWT ID replay protection cache for receipt verification (database-backed with automatic expiry cleanup).
- `partners`: Partner organizations for API key multi-tenancy (name, contact email, active status).
- `api_keys`: Scoped API keys with Argon2id hashing (never stores plaintext secrets, peppered derivation).

**Database-Backed Services**:
- `server/services/status-list-repo.ts`: PostgreSQL persistence for W3C Bitstring Status Lists with atomic bit operations and ETag-based optimistic locking.
- `server/services/jti-repo.ts`: PostgreSQL-backed JTI replay cache with automatic cleanup of expired entries (runs every 5 minutes).
- Background cleanup tasks ensure database hygiene without manual intervention.

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

## API Key Authentication & Partner Management

**Architecture**: Multi-tenant API key authentication system with Argon2id hashing, pepper-based key derivation, and scope-based authorization (October 2025).

### Partner Management
- **Database**: `partners` table stores partner organizations with contact info and active status
- **Fields**: partnerId (UUID), name, contactEmail, active flag, timestamps
- **Access Control**: Only users with `admin:*` scope can create/manage partners

### API Key System
- **Storage**: `api_keys` table with secure Argon2id hashing (never stores plaintext secrets)
- **Key Format**: `{prefix}{id}.{secret}` (e.g., `mpk_abc123def456.hex64...`)
  - Prefix: Configurable brand identifier (default: `mpk_`)
  - ID: Short identifier for key lookup
  - Secret: 256-bit random hex string (shown once at creation)
- **Security Features**:
  - Argon2id hashing with server-side pepper (HMAC-SHA256)
  - Peppered key derivation for defense-in-depth
  - Automatic header redaction in logs
  - Rate limiting per key (configurable per partner)
  - Temporal validity (notBefore/notAfter timestamps)
  
### Scope-Based Authorization
- **Available Scopes**:
  - `assets:mint` - Create new proof assets
  - `assets:read` - View proof assets
  - `status:update` - Update W3C Status List bits
  - `transfer:execute` - Execute proof asset transfers
  - `audit:read` - Read audit events
  - `admin:*` - Full administrative access (create partners, issue keys, etc.)
- **Scope Guards**: Middleware validates scopes before allowing access to protected routes
- **Wildcard Admin**: Keys with `admin:*` scope automatically pass all scope checks

### Admin API Endpoints
All admin endpoints require authentication with `admin:*` scope:
- `POST /api/admin/partners` - Create new partner organization
- `GET /api/admin/partners` - List all partners
- `POST /api/admin/api-keys/issue` - Issue new API key for a partner
  - Request: `{ partnerId, scopes, notAfter? }`
  - Response: `{ token, keyId }` (plaintext token shown once)
- `GET /api/admin/api-keys` - List all API keys (secrets redacted)
- `POST /api/admin/api-keys/:keyId/revoke` - Revoke an API key
- `POST /api/admin/api-keys/:keyId/rotate` - Rotate an API key (revoke old, issue new)

### Authentication Flow
1. **Client Request**: Include API key in header
   - `X-API-Key: {keyId}.{secret}` OR
   - `Authorization: ApiKey {keyId}.{secret}`
2. **Middleware Validation**:
   - Parse keyId and secret
   - Lookup key in database
   - Verify status is "active"
   - Check temporal validity (notBefore/notAfter)
   - Derive peppered secret and verify Argon2id hash
   - Verify partner is active
   - Update lastUsedAt timestamp
3. **Scope Authorization**: Route-specific middleware checks required scopes
4. **Request Processing**: Attach partner context to `req.auth`

### Key Management Operations
- **Issue**: Create new API key with specified scopes and optional expiry
- **Rotate**: Revoke old key and issue new key with same partner/scopes (for key rotation policies)
- **Revoke**: Mark key as inactive (soft delete for audit trail)
- **List**: View all keys with metadata (secrets never returned)

### Security Properties
- **No Plaintext Storage**: Secrets never persisted (only Argon2id hashes)
- **Peppered Derivation**: Server-side pepper adds defense-in-depth
- **Replay Protection**: Keys validated on every request
- **Automatic Redaction**: Sensitive headers redacted from logs
- **Temporal Control**: Optional notBefore/notAfter for time-bound access
- **Rate Limiting**: Per-key rate limits (configurable)
- **Scope Isolation**: Partners can only perform authorized actions

### Environment Variables (API Keys)
- `APIKEY_PEPPER` - Server-side pepper for key derivation (required in production, 32+ random bytes)
- `APIKEY_ID_PREFIX` - Visible key ID prefix for branding (default: `mpk_`)
- `APIKEY_SECRET_BYTES` - Secret length in bytes (default: 32 = 256 bits)

### 7. Privacy-First Logging
- Sensitive data automatically redacted from logs
- Only opaque IDs, truncated hashes, statusVerdict, trace_id logged

## External Dependencies

**Required Services**:
- **PostgreSQL Database**: Via Neon serverless for production persistence.

**Third-Party Libraries**:
- **Frontend**: `@tanstack/react-query`, `@radix-ui/*`, `wouter`, `date-fns`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `react-hook-form`, `@hookform/resolvers`.
- **Backend**: `express`, `drizzle-orm`, `drizzle-zod`, `@neondatabase/serverless`, `ws`, `nanoid`, `argon2`, `uuid`.
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
- `APIKEY_PEPPER` - Server-side pepper for API key derivation (required in production, 32+ random bytes)
- `APIKEY_ID_PREFIX` - Visible key ID prefix for branding (default: `mpk_`)
- `APIKEY_SECRET_BYTES` - Secret length in bytes for API keys (default: 32 = 256 bits)