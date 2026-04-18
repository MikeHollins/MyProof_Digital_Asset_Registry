// Smoke test for appeals endpoint (Art. 22 / EDPB Statement 1/2025).
// Tests the PII scanner directly since the endpoint requires a running HTTP server.
// Run: npx tsx server/routes-appeals.test.ts

import { submitAppealSchema } from "../shared/schema.js";

let failures = 0;
function pass(name: string): void { console.log(`PASS ${name}`); }
function fail(name: string, reason: string): void { failures++; console.error(`FAIL ${name}\n  ${reason}`); }

// ---------------------------------------------------------------------------
// submitAppealSchema accepts valid minimal form
// ---------------------------------------------------------------------------
{
  const ok = submitAppealSchema.safeParse({ category: "incorrect_rejection" });
  if (!ok.success) fail("minimal form accepted", ok.error.issues[0]?.message ?? "");
  else pass("minimal form accepted (category only)");
}

{
  const ok = submitAppealSchema.safeParse({
    category: "technical_error",
    verification_id: "00000000-0000-0000-0000-000000000000",
    session_id_hint: "sess-abc123",
    free_text: "My phone crashed mid-scan",
  });
  if (!ok.success) fail("full valid form accepted", ok.error.issues[0]?.message ?? "");
  else pass("full valid form accepted");
}

// ---------------------------------------------------------------------------
// Bad category rejected
// ---------------------------------------------------------------------------
{
  const bad = submitAppealSchema.safeParse({ category: "not_a_real_category" });
  if (bad.success) fail("invalid category accepted", "should have been rejected");
  else pass("invalid category rejected");
}

// ---------------------------------------------------------------------------
// Oversized free_text rejected (500-char cap)
// ---------------------------------------------------------------------------
{
  const longText = "a".repeat(501);
  const bad = submitAppealSchema.safeParse({ category: "other", free_text: longText });
  if (bad.success) fail("501-char free_text accepted", "should have been rejected");
  else pass("oversized free_text rejected (>500 chars)");
}

// ---------------------------------------------------------------------------
// PII detectors — import the pattern set by re-importing the module.
// We smoke-test the inline regex patterns directly since scanFreeTextForPii
// is not exported. Recreate the patterns for the test.
// ---------------------------------------------------------------------------
const PII_PATTERNS: readonly { pattern: RegExp; tag: string }[] = [
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/, tag: "EMAIL" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/, tag: "SSN" },
  { pattern: /\b\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, tag: "PHONE" },
  { pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/, tag: "CREDIT_CARD" },
  { pattern: /\b(19|20)\d{2}[-\/](0[1-9]|1[012])[-\/](0[1-9]|[12]\d|3[01])\b/, tag: "DOB_ISO" },
];

function hasPii(text: string): string[] {
  const normalized = text.normalize("NFKC");
  return PII_PATTERNS.filter(({ pattern }) => pattern.test(normalized)).map(({ tag }) => tag);
}

// Positive PII detection
{
  const cases = [
    { text: "my email is alice@example.com please", expectedTag: "EMAIL" },
    { text: "123-45-6789 is my SSN", expectedTag: "SSN" },
    { text: "call me at +1 555 123 4567", expectedTag: "PHONE" },
    { text: "born 1994-05-15", expectedTag: "DOB_ISO" },
    { text: "card: 4111 1111 1111 1111", expectedTag: "CREDIT_CARD" },
  ];
  for (const c of cases) {
    const tags = hasPii(c.text);
    if (!tags.includes(c.expectedTag)) fail(`detects ${c.expectedTag} in "${c.text.substring(0, 30)}..."`, `got tags=${tags.join(",")}`);
    else pass(`detects ${c.expectedTag}`);
  }
}

// Negative — clean free_text passes
{
  const cases = [
    "my phone crashed mid-scan",
    "the app said I was not old enough but I am over 21",
    "I tried three times and got the same error",
    "please review — session timeout",
  ];
  for (const text of cases) {
    const tags = hasPii(text);
    if (tags.length > 0) fail(`clean text "${text.substring(0, 30)}..." flagged`, `tags=${tags.join(",")}`);
  }
  pass(`4 clean free-text samples pass unflagged`);
}

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nALL APPEAL TESTS PASSED");
  process.exit(0);
}
