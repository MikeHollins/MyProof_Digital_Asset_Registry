# Proof-Asset Registry (PAR)

## Overview

The Proof-Asset Registry (PAR) is a privacy-first, enterprise-grade cryptographic proof management platform designed for secure registration, verification, and lifecycle management of verifiable cryptographic proofs. The system emphasizes data minimization (no PII storage), content-addressable immutability using CIDs, W3C-compliant credential status tracking, and append-only audit transparency.

PAR serves as a trusted registry for cryptographic proofs including zero-knowledge proofs, JSON Web Signatures (JWS), linked data proofs, hardware attestations, Merkle proofs, and blockchain transaction proofs. The platform enables verifiers, issuers, and relying parties to register proof assets, track their verification status, manage revocation/suspension via W3C Bitstring Status Lists, and maintain a complete audit trail of all state-changing operations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Application Structure

**Monorepo Architecture**: The application uses a modern full-stack monorepo structure with three primary domains:

- `client/`: React-based frontend built with Vite
- `server/`: Express.js backend API
- `shared/`: Shared TypeScript schemas and types (Drizzle ORM schemas, Zod validators)

### Frontend Architecture

**Framework Stack**:
- **React 18** with TypeScript for type-safe component development
- **Vite** as the build tool and development server
- **Wouter** for lightweight client-side routing
- **TanStack Query (React Query)** for server state management, data fetching, and caching

**UI Component System**:
- **Radix UI** primitives for accessible, unstyled component foundation
- **shadcn/ui** component library using the "new-york" style variant
- **Tailwind CSS** for utility-first styling with custom design tokens
- **IBM Plex Sans** and **IBM Plex Mono** typography (loaded via Google Fonts)

**Design Philosophy**: Following Carbon Design System principles adapted for cryptographic data management - precision over decoration, monospace fonts for technical identifiers (DIDs, CIDs, hashes), and clear visual hierarchy for complex proof metadata.

**State Management Strategy**:
- TanStack Query handles all server state (proofs, audit events, status lists, system health)
- Local component state for UI interactions (filters, view modes, form inputs)
- No global client-side state management library needed due to server-driven architecture

### Backend Architecture

**Server Framework**: Express.js with TypeScript, running on Node.js 20+

**API Design**:
- RESTful endpoints under `/api/*` namespace
- JSON request/response format with explicit content-type validation
- Logging middleware captures request duration and response bodies (truncated for brevity)
- Raw body capture for potential signature verification

**Core API Endpoints**:
- `GET /api/health` - System health check with database connectivity status
- `GET /api/stats` - Dashboard statistics (total proofs, verification counts, status breakdowns)
- `GET /api/proof-assets` - List all registered proof assets with filtering
- `GET /api/proof-assets/:id` - Get single proof asset by ID
- `POST /api/proof-assets` - Register new proof asset with verification
- `POST /api/proof-assets/:id/verify` - Re-verify existing proof asset, updates verification metadata and creates audit event
- `GET /api/audit-events` - Retrieve append-only audit log
- `GET /api/status-lists` - W3C Bitstring Status List management

**Data Storage Strategy**:

The application uses an abstraction layer (`IStorage` interface) allowing multiple storage backends:

1. **In-Memory Storage** (`MemStorage`): Current implementation for development/testing using Map data structures and in-memory arrays
2. **Database Storage** (future/production): PostgreSQL via Neon serverless with Drizzle ORM

**Rationale**: The storage abstraction enables rapid prototyping without database setup while maintaining a clear migration path to production persistence. The interface defines all CRUD operations needed for proof assets, audit events, and status lists.

### Database Schema (PostgreSQL + Drizzle ORM)

**Tables**:

1. **`proof_assets`**: Core registry of cryptographic proofs with strict privacy constraints
   - Primary key: `proof_asset_id` (UUID)
   - Unique constraint on `proof_asset_commitment` (ensures no duplicate proof registrations)
   - Indexes on: `issuer_did`, `proof_format`, `verification_status`, `status_list_url + status_list_index`
   - **No PII fields**: Only stores DIDs, cryptographic digests, CIDs, and status pointers

2. **`audit_events`**: Append-only transparency log with hash-chaining capability
   - Primary key: `event_id` (UUID)
   - Captures: event type, asset ID, payload (JSONB), trace ID, previous hash, current hash
   - Enables Merkle-tree-style verification of event sequence integrity

3. **`status_lists`**: W3C Bitstring Status List registry
   - Stores compressed bitstrings for revocation/suspension tracking
   - ETag support for optimistic concurrency control

**Privacy-First Design Decisions**:
- **Zero PII Storage**: Schema prohibits personally identifiable information (names, DOB, addresses, SSN)
- **Content Addressability**: All policies, constraints, circuits, and schemas referenced via CIDv1 (IPFS-style content identifiers)
- **Cryptographic Commitments**: Proof assets identified by deterministic commitments derived from proof content
- **Audit Transparency**: Every state change logged with cryptographic hash chaining

### Authentication & Authorization (Planned)

The architecture anticipates these auth mechanisms (not yet implemented):

- **OIDC** for partner/enterprise authentication
- **DID-Auth** via custom headers for decentralized identity verification
- **mTLS** for service-to-service communication in production deployments

### Data Flow & Verification Pipeline

1. **Proof Registration**:
   - Client submits proof metadata (issuer DID, proof format, digest, policy CID, etc.)
   - Server generates commitment hash from proof data
   - Proof verification stub called (placeholder - production would integrate ZK verifiers, JWS validators, etc.)
   - Status list allocation (assigns index in revocation/suspension bitstring)
   - Atomic write to storage with audit event creation
   - Response includes verification result, assigned IDs, and status references

2. **Status Management**:
   - W3C Bitstring Status List pattern for efficient revocation/suspension
   - Bitwise operations on compressed status lists (not yet implemented)
   - ETag-based optimistic locking prevents concurrent update conflicts

3. **Audit Trail**:
   - Every mutation (MINT, USE, TRANSFER, STATUS_UPDATE) creates an audit event
   - Hash chaining links events together (previous_hash → current_hash)
   - Enables cryptographic verification of event sequence integrity

## External Dependencies

### Required Services

1. **PostgreSQL Database**: Production persistence layer
   - Accessed via Neon serverless (@neondatabase/serverless)
   - Connection pooling via `pg-pool`
   - WebSocket support for serverless environments

2. **Drizzle ORM**: Type-safe database toolkit
   - Schema definition in `shared/schema.ts`
   - Zod schema generation for runtime validation
   - Migration management via `drizzle-kit`

### Third-Party Libraries

**Frontend**:
- `@tanstack/react-query` - Server state management and caching
- `@radix-ui/*` - Headless accessible UI primitives (accordion, dialog, dropdown, select, tabs, toast, tooltip, etc.)
- `wouter` - Lightweight routing
- `date-fns` - Date formatting and manipulation
- `class-variance-authority` + `clsx` + `tailwind-merge` - Dynamic className composition
- `lucide-react` - Icon library
- `react-hook-form` + `@hookform/resolvers` - Form state management with Zod validation

**Backend**:
- `express` - HTTP server framework
- `drizzle-orm` + `drizzle-zod` - ORM and schema validation
- `@neondatabase/serverless` - Neon PostgreSQL client with WebSocket support
- `ws` - WebSocket client for serverless database connections
- `nanoid` - Unique ID generation

**Build Tools**:
- `vite` - Frontend build tool and dev server
- `esbuild` - Backend bundling
- `tsx` - TypeScript execution for development
- `tailwindcss` + `postcss` + `autoprefixer` - CSS toolchain

### External APIs & Integrations (Future)

The architecture anticipates integration with:

1. **ZK Proof Verification Services**: For validating zero-knowledge proofs (Groth16, PLONK, STARKs)
2. **W3C Verifiable Credentials**: Status list hosting and resolution
3. **IPFS/Content-Addressable Storage**: For storing policies, schemas, and circuit definitions via CIDs
4. **DID Resolvers**: For verifying issuer and subject DIDs
5. **OpenTelemetry Collectors**: For distributed tracing and observability

### Environment Configuration

**Required Environment Variables**:
- `DATABASE_URL`: PostgreSQL connection string (Neon serverless format)
- `NODE_ENV`: Runtime environment (development/production)
- `STATUS_BASE_URL`: Base URL for W3C Status List resolution (optional, defaults to example.com)

**Build & Deployment**:
- Development: `npm run dev` - Concurrent frontend (Vite) + backend (tsx watch mode)
- Production build: `npm run build` - Vite static build + esbuild server bundle
- Database schema: `npm run db:push` - Drizzle schema sync to PostgreSQL