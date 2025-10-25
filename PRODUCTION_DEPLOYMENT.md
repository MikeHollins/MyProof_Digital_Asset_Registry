# Production Deployment Guide - Proof-Asset Registry (PAR)

## Overview

This guide covers the production hardening features implemented in PAR and how to deploy them securely.

## Production Hardening Features

### 1. Redis Replay Cache (server/redis-client.ts, server/receipt-service.ts)

**Purpose**: Prevents JWT replay attacks in receipt-based verification using distributed cache.

**Features**:
- Distributed JTI (JWT ID) tracking across multiple instances
- Automatic in-memory fallback for development/single-instance deployments
- NX flag semantics (only set if not exists) for atomic replay detection
- Automatic TTL cleanup (10 minutes)

**Configuration**:
```bash
# Production (required for horizontal scaling)
REDIS_URL=redis://your-redis-instance:6379

# Development (optional - uses in-memory cache if not set)
# REDIS_URL= # Leave empty for automatic fallback
```

**Monitoring**:
- Watch for `[redis-client] Using in-memory cache` warnings in production logs
- Set up Redis health monitoring and alerting
- Track replay cache hit rates and TTL expiration

---

### 2. W3C Status List Client (server/status-list-client.ts, server/routes.ts)

**Purpose**: Fail-closed status verification using W3C Bitstring Status Lists.

**Features**:
- ETag-based conditional fetching (304 Not Modified optimization)
- Staleness detection with configurable threshold (default: 24h)
- **Fail-closed behavior**: Rejects verification if status list unreachable or stale
- URL normalization for consistent caching
- Bitstring index checking (0 = active, 1 = revoked/suspended)

**Configuration**:
```bash
# Base URL for W3C Status Lists
STATUS_BASE_URL=https://status.your-domain.com/lists

# Maximum staleness before failing closed (milliseconds)
STATUS_MAX_STALENESS_MS=86400000  # 24 hours

# Fetch timeout (milliseconds)
STATUS_FETCH_TIMEOUT_MS=3000  # 3 seconds
```

**Security Model**:
- If status list unreachable → Verification fails with 503 error
- If status list stale (beyond threshold) → Verification fails with 503 error
- Only returns "verified" if list confirms status bit is clear (0)

**Monitoring**:
- Set up alerting for 503 errors from `/api/proof-assets/:id/re-verify`
- Monitor status list fetch latency and failure rates
- Track ETag cache hit rates

---

### 3. SRI Proof Fetcher (server/sri-fetcher.ts)

**Purpose**: Secure proof fetching with Subresource Integrity validation.

**Features**:
- HTTPS-only enforcement (production)
- Host allowlist for proof URIs
- Size cap (default: 128KB) to prevent DoS
- Timeout protection (default: 3s)
- Streaming digest validation (aborts on mismatch)
- Development-friendly data: URI support

**Configuration**:
```bash
# Maximum proof size (bytes)
PROOF_MAX_SIZE_BYTES=131072  # 128KB

# Fetch timeout (milliseconds)
PROOF_FETCH_TIMEOUT_MS=3000  # 3 seconds

# Host allowlist (production only - comma-separated)
PROOF_ALLOWED_HOSTS=cdn.example.com,trusted-storage.net
```

**Security Notes**:
- In production, `PROOF_ALLOWED_HOSTS` **must** be set to prevent SSRF attacks
- Only HTTPS URIs are allowed (no HTTP)
- Development mode allows `data:` URIs for testing

**Monitoring**:
- Track proof fetch failures and digest mismatches
- Monitor fetch latency and size distribution
- Alert on SSRF attempts (blocked by allowlist)

---

### 4. Receipt Verification Keys (server/routes.ts)

**Purpose**: ES256 keypair for signing and verifying cryptographic receipts.

**Key Generation**:
On first startup without keys, the application generates an ephemeral keypair:

```
[receipt-keys] ⚠️  DEVELOPMENT MODE: Generating ephemeral receipt keys
[receipt-keys] Generated new keypair (kid: ...)
[receipt-keys] Public JWKS (safe to share):
RECEIPT_VERIFIER_PUBLIC_JWK='{"kty":"EC","x":"...","y":"...","crv":"P-256","kid":"...","alg":"ES256"}'
[receipt-keys] Private JWK (display once, save securely):
{ "kty": "EC", "x": "...", "y": "...", "d": "...", "crv": "P-256", "kid": "...", "alg": "ES256" }
```

**Production Setup**:
1. **Generate persistent keypair** (one-time):
   - Run the application once in development
   - Copy the generated keypair from logs
   - Store private JWK in secrets manager (KMS/Vault/HSM)

2. **Configure environment**:
   ```bash
   # Public key (safe to share)
   RECEIPT_VERIFIER_PUBLIC_JWK='{"kty":"EC","x":"...","y":"...","crv":"P-256","kid":"...","alg":"ES256"}'
   
   # Private key (KEEP SECRET - only in verifier service)
   RECEIPT_VERIFIER_PRIVATE_JWK='{"kty":"EC","x":"...","y":"...","d":"...","crv":"P-256","kid":"...","alg":"ES256"}'
   ```

**Security Notes**:
- **NEVER** commit private JWK to version control
- In production, consider separate Registry (public key) and Verifier Service (private key) roles
- Rotate keys periodically and update `kid` field
- Use HSM/KMS for private key storage in production

---

### 5. Express Security Hardening (server/index.ts)

**Purpose**: Defense-in-depth security controls.

**Features**:
- **Rate Limiting**:
  - DID-based (x-did header) - most privacy-preserving
  - Client-ID fallback (x-client-id header)
  - IPv6-safe IP bucketing (using `ipKeyGenerator`)
  - 100 requests per 15 minutes per client
  - 50 mutations per 15 minutes per client
  
- **Security Headers**:
  - Helmet CSP, HSTS (31536000s, includeSubDomains, preload)
  - X-Powered-By disabled
  - Trust proxy enabled (Replit reverse proxy)
  
- **Body Size Limits**:
  - 64KB cap for JSON/URL-encoded bodies
  - Prevents DoS via large payloads
  
- **Raw Body Capture**:
  - Preserves raw Buffer via `verify` callback
  - Required for JWS/JWT signature validation
  
- **RFC 7807 Error Handler**:
  - Structured error responses
  - Prevents information disclosure

**Configuration**:
```bash
# Node environment
NODE_ENV=production

# Server port
PORT=5000
```

---

## Pre-Deployment Checklist

### Required Configuration

- [ ] **Redis URL**: Set `REDIS_URL` for distributed replay cache
- [ ] **Status List Base**: Set `STATUS_BASE_URL` for W3C status lists
- [ ] **Proof Allowlist**: Set `PROOF_ALLOWED_HOSTS` for SSRF protection
- [ ] **Receipt Keys**: Generate and persist `RECEIPT_VERIFIER_PUBLIC_JWK` and `RECEIPT_VERIFIER_PRIVATE_JWK`
- [ ] **Database**: Verify `DATABASE_URL` is configured
- [ ] **Session Secret**: Verify `SESSION_SECRET` is set

### Security Review

- [ ] Private JWK stored securely (KMS/Vault/HSM)
- [ ] HTTPS-only enforcement enabled
- [ ] Host allowlist configured for proof URIs
- [ ] Rate limiting tested (verify isolated buckets per client)
- [ ] Fail-closed behavior tested (unreachable status lists → 503)
- [ ] Replay cache tested (duplicate JTI → rejection)

### Monitoring Setup

- [ ] Redis health monitoring and alerting
- [ ] Status list fetch failure alerting
- [ ] 503 error rate monitoring
- [ ] Rate limit hit rate tracking
- [ ] Proof fetch latency and failure tracking

---

## Integration Testing

Before deploying to production, run the following integration tests:

### 1. Receipt Replay Attack Test
```bash
# Register a proof and capture receipt
# Attempt to re-verify with same receipt twice
# Expected: Second attempt should fail with "replay_detected"
```

### 2. Status List Outage Test
```bash
# Configure unreachable STATUS_BASE_URL
# Attempt re-verification
# Expected: 503 error with failClosed: true
```

### 3. Large Proof Fetch Test
```bash
# Attempt to register proof with URI pointing to >128KB file
# Expected: "Proof exceeds maximum size" error
```

### 4. Rate Limiting Test
```bash
# Send 101 requests without x-did/x-client-id headers from same IP
# Expected: 101st request returns 429 Too Many Requests
```

---

## Production Deployment Steps

1. **Set Environment Variables**:
   ```bash
   export NODE_ENV=production
   export REDIS_URL=redis://your-redis:6379
   export STATUS_BASE_URL=https://status.your-domain.com/lists
   export PROOF_ALLOWED_HOSTS=cdn.example.com,trusted.net
   export RECEIPT_VERIFIER_PUBLIC_JWK='...'
   export RECEIPT_VERIFIER_PRIVATE_JWK='...'
   ```

2. **Verify Database Migrations**:
   ```bash
   npm run db:push
   ```

3. **Start Application**:
   ```bash
   npm run dev  # Development
   npm start    # Production
   ```

4. **Health Check**:
   ```bash
   curl https://your-domain.com/api/health
   # Expected: {"status":"ok","timestamp":"..."}
   ```

5. **Monitor Startup Logs**:
   - Verify Redis connection (no fallback warning)
   - Verify receipt keys loaded (not generated)
   - Verify no security warnings

---

## Operational Guidance

### Redis Failover

If Redis becomes unavailable:
- Application automatically falls back to in-memory cache
- Logs warning: `[redis-client] Using in-memory cache`
- Replay protection continues (single-instance only)
- **Action**: Restore Redis ASAP for distributed protection

### Status List Staleness

If status lists become stale:
- All re-verifications fail with 503 error
- Logs: `Status list unreachable and cache stale`
- **Action**: Verify `STATUS_BASE_URL` accessibility and fix upstream

### Receipt Key Rotation

To rotate receipt signing keys:
1. Generate new keypair (run app once in dev mode)
2. Add new public key to JWKS endpoint (multi-key support)
3. Update `RECEIPT_VERIFIER_PRIVATE_JWK` to new private key
4. Keep old public key in JWKS for verification (grace period)
5. After grace period, remove old public key from JWKS

---

## Security Contacts

For security vulnerabilities, contact: security@your-domain.com

---

## References

- W3C Verifiable Credentials Status List: https://www.w3.org/TR/vc-status-list/
- RFC 8785 (JSON Canonicalization): https://datatracker.ietf.org/doc/html/rfc8785
- RFC 7807 (Problem Details): https://datatracker.ietf.org/doc/html/rfc7807
- Express Rate Limit: https://express-rate-limit.mintlify.app/
- JOSE (JWS/JWT): https://github.com/panva/jose
