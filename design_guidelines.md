# Design Guidelines: Proof-Asset Registry (PAR)

## Design Approach
**System Selected**: Carbon Design System
**Rationale**: PAR is a data-intensive, enterprise-grade cryptographic proof management platform requiring precise data visualization, complex workflow support, and trustworthy UI patterns. Carbon's focus on information density, structured layouts, and technical clarity aligns perfectly with security infrastructure applications.

## Core Design Principles
- **Precision Over Decoration**: Every element serves a functional purpose
- **Transparency Through Clarity**: Complex cryptographic operations made understandable
- **Trust Through Consistency**: Predictable patterns build user confidence
- **Efficiency First**: Minimize clicks for critical verification workflows

## Typography System
**Families**:
- Primary: IBM Plex Sans (via Google Fonts)
- Monospace: IBM Plex Mono (for hashes, DIDs, CIDs, proof digests)

**Hierarchy**:
- Page Titles: text-4xl font-semibold (2.25rem/36px)
- Section Headers: text-2xl font-semibold (1.5rem/24px)
- Card Headers: text-lg font-medium (1.125rem/18px)
- Body Text: text-base (1rem/16px)
- Helper Text: text-sm text-gray-600 (0.875rem/14px)
- Monospace Data: text-sm font-mono (hashes, IDs, timestamps)

## Layout System
**Spacing Primitives**: Tailwind units of 4, 6, 8, 12, 16 (e.g., p-4, gap-6, my-8, py-12, mt-16)

**Container Strategy**:
- Dashboard shell: Full viewport with fixed sidebar (w-64) + main content area
- Content max-width: max-w-7xl mx-auto for primary workspace
- Dense data views: max-w-full to maximize horizontal space for tables

**Grid Patterns**:
- Metrics/Stats: grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6
- Proof Cards: grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4
- Forms: Single column max-w-2xl for optimal input width

## Component Library

### Navigation
**Sidebar Navigation** (Primary):
- Fixed left sidebar (w-64) with logo at top
- Vertical nav items with icons (Heroicons)
- Active state: subtle background treatment + left border accent
- Sections: Dashboard, Proofs, Verification, Status Lists, Audit Logs, Settings

**Top Bar**:
- User DID display with truncation (font-mono text-sm)
- System status indicator (real-time health)
- Quick actions dropdown

### Data Display

**Proof Cards**:
- Border with subtle shadow (border rounded-lg p-6)
- Header: Proof format badge + timestamp
- Body: Proof digest (truncated, expandable), verification status
- Footer: Action buttons (View Details, Verify, Revoke)

**Status Indicators**:
- Verified: Green dot + "Verified" label
- Pending: Yellow dot + "Pending Verification"
- Revoked: Red dot + "Revoked"
- Suspended: Orange dot + "Suspended"
- Use filled circles (w-2.5 h-2.5 rounded-full) before text labels

**Data Tables**:
- Zebra striping for row clarity (even:bg-gray-50)
- Fixed headers on scroll (sticky top-0)
- Sortable columns with visual indicators
- Monospace for: CIDs, DIDs, hashes, proof digests
- Action column (right-aligned) with icon buttons
- Pagination controls at bottom

**Audit Log Timeline**:
- Vertical timeline with left border connector
- Event cards connected to timeline
- Timestamp (absolute + relative)
- Event type badge
- Hash-chain visualization (previous hash reference)

### Forms & Inputs

**Proof Registration Form**:
- Section grouping with clear labels
- Required field indicators (red asterisk)
- Proof format selector (radio buttons with descriptions)
- File upload for proof artifacts (drag-drop zone)
- Digest algorithm dropdown (SHA-256, SHA-512, BLAKE2b)
- DID input with validation pattern
- Helper text below inputs explaining technical requirements

**Input Styling**:
- Standard: border rounded px-4 py-2 focus:ring-2 focus:ring-offset-1
- Monospace inputs for technical data
- Error states: red border + error message below
- Disabled: reduced opacity + cursor-not-allowed

### Buttons & Actions

**Primary Actions**: Solid background, medium weight text
**Secondary Actions**: Border outline, transparent background
**Danger Actions**: Red variant for revoke/delete operations
**Icon Buttons**: Minimal padding (p-2), hover background

Sizes: text-sm px-4 py-2 (default), text-xs px-3 py-1.5 (compact)

### Overlays

**Modal Dialogs**:
- Centered with backdrop (backdrop-blur-sm bg-black/30)
- Max width constraints (max-w-2xl for forms, max-w-4xl for details)
- Header with close button (X icon)
- Footer with action buttons (right-aligned)

**Verification Details Modal**:
- Tabbed interface: Overview | Proof Data | Verification Log | Status History
- Syntax-highlighted JSON for proof payloads
- Collapsible sections for verbose data

**Toast Notifications**:
- Fixed top-right position
- Success/Error/Info variants
- Auto-dismiss after 5s (with progress bar)
- Show for: Verification complete, Proof registered, Status updated

### Specialized Components

**CID/Hash Display**:
- Monospace font
- Truncated with tooltip on hover showing full value
- Copy-to-clipboard icon button
- Visual differentiation: light background (bg-gray-100 rounded px-2 py-1)

**Verification Status Badge**:
- Pill shape (rounded-full px-3 py-1)
- Icon + text combination
- Color-coded backgrounds (green/yellow/red/gray)

**Proof Format Badge**:
- Small rectangular badge (rounded px-2 py-0.5 text-xs)
- Muted background colors by type (ZK_PROOF: purple, JWS: blue, etc.)

## Dashboard Layout

**Main Dashboard Page**:
1. Stats Overview (4 metric cards): Total Proofs, Verified Today, Active Status Lists, Pending Verifications
2. Recent Verifications Table (compact, 10 rows)
3. System Health Indicators (3-column grid): DB Status, Redis Status, Verifier Service Status
4. Quick Actions Panel: Register New Proof, Check Verification Status

**Proof Management Page**:
- Filters sidebar (left): Format, Status, Date Range, DID filter
- Main content: Proof cards grid or table view toggle
- Bulk actions toolbar when items selected

**Verification Page**:
- Step indicator for verification workflow
- Proof input form → Verification execution (loading) → Results display
- Results: Verification outcome, derived facts display, audit record link

## Visual Treatments

**Backgrounds**: Predominantly white/gray-50 for content areas
**Borders**: gray-200 for subtle separation, gray-300 for emphasis
**Shadows**: Minimal use - sm for cards, md for modals only
**Corners**: rounded (0.375rem) for cards, rounded-lg (0.5rem) for modals

## Animations
**Minimal & Purposeful**:
- Table row hover: Background color transition (duration-150)
- Button hover: Slight scale (hover:scale-[1.02]) only for primary CTAs
- Modal entrance: Fade in backdrop + scale-95 to scale-100 for dialog
- Loading states: Subtle spinner, no skeleton screens for data tables

## Accessibility
- ARIA labels on all icon-only buttons
- Focus rings visible on all interactive elements (ring-2 ring-offset-2)
- Keyboard navigation support (tab order, escape to close modals)
- Color is never sole indicator (always icon + text for status)
- Sufficient contrast ratios (WCAG AA minimum)

## Responsive Adaptations
- Sidebar collapses to hamburger menu on mobile (< lg breakpoint)
- Tables switch to card view on small screens
- Multi-column grids stack to single column
- Touch-friendly target sizes (min 44px) on mobile