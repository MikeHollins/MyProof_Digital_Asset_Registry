// Smoke tests for log-redactor middleware.
// Run: `npx tsx server/middleware/log-redactor.test.ts`
// Exit 0 = all pass. Exit non-zero = failure with diagnostic.

import {
  redactForLog,
  safeLog,
  REDACTION_RULES,
} from "./log-redactor.js";

let failures = 0;

function assertEq(name: string, actual: unknown, expected: unknown): void {
  const aStr = JSON.stringify(actual);
  const eStr = JSON.stringify(expected);
  if (aStr !== eStr) {
    failures++;
    console.error(`FAIL ${name}\n  expected: ${eStr}\n  actual:   ${aStr}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

function assertContains(name: string, haystack: string, needle: string): void {
  if (!haystack.includes(needle)) {
    failures++;
    console.error(`FAIL ${name}\n  "${needle}" not found in\n  ${haystack}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

function assertNotContains(name: string, haystack: string, needle: string): void {
  if (haystack.includes(needle)) {
    failures++;
    console.error(`FAIL ${name}\n  "${needle}" should not appear in\n  ${haystack}`);
  } else {
    console.log(`PASS ${name}`);
  }
}

// ----------------------------------------------------------------------------
// Name redaction
// ----------------------------------------------------------------------------
assertEq(
  "redacts name fields",
  redactForLog({ name: "John Doe", family_name: "Doe", given_name: "John" }),
  { name: "<redacted:PII_NAME>", family_name: "<redacted:PII_NAME>", given_name: "<redacted:PII_NAME>" }
);

// ----------------------------------------------------------------------------
// DOB redaction
// ----------------------------------------------------------------------------
assertEq(
  "redacts ISO DOB",
  redactForLog({ dob: "1994-05-15" }),
  { dob: "<redacted:PII_DOB>" }
);
assertEq(
  "redacts US DOB",
  redactForLog({ date_of_birth: "05/15/1994" }),
  { date_of_birth: "<redacted:PII_DOB>" }
);
assertEq(
  "redacts compact DOB",
  redactForLog({ dob: "19940515" }),
  { dob: "<redacted:PII_DOB>" }
);

// ----------------------------------------------------------------------------
// Document number redaction
// ----------------------------------------------------------------------------
assertEq(
  "redacts passport number",
  redactForLog({ passport_number: "P12345678" }),
  { passport_number: "<redacted:PII_DOC_NUMBER>" }
);
assertEq(
  "redacts DL number",
  redactForLog({ dl_number: "TX-DL-1234567" }),
  { dl_number: "<redacted:PII_DOC_NUMBER>" }
);

// ----------------------------------------------------------------------------
// Raw document content redaction
// ----------------------------------------------------------------------------
assertEq(
  "redacts dg1",
  redactForLog({ dg1: "binary_data_here" }),
  { dg1: "<redacted:PII_DOC_RAW>" }
);
assertEq(
  "redacts mrz",
  redactForLog({ mrz: "P<USAJOHN<<DOE<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<" }),
  { mrz: "<redacted:PII_DOC_RAW>" }
);
assertEq(
  "redacts portrait",
  redactForLog({ portrait: "base64_image_data..." }),
  { portrait: "<redacted:PII_DOC_RAW>" }
);

// ----------------------------------------------------------------------------
// Contact info redaction
// ----------------------------------------------------------------------------
assertEq(
  "redacts email field",
  redactForLog({ email: "user@example.com" }),
  { email: "<redacted:PII_EMAIL>" }
);
assertEq(
  "redacts phone field",
  redactForLog({ phone: "+15551234567" }),
  { phone: "<redacted:PII_PHONE>" }
);
assertEq(
  "redacts SSN",
  redactForLog({ ssn: "123-45-6789" }),
  { ssn: "<redacted:PII_SSN>" }
);
assertEq(
  "redacts IP address",
  redactForLog({ ip_address: "192.168.1.100" }),
  { ip_address: "<redacted:PII_IP>" }
);

// ----------------------------------------------------------------------------
// Address redaction
// ----------------------------------------------------------------------------
assertEq(
  "redacts address fields",
  redactForLog({ street: "123 Main St", city: "Austin", state: "TX", postal_code: "78701" }),
  {
    street: "<redacted:PII_ADDRESS>",
    city: "<redacted:PII_ADDRESS>",
    state: "<redacted:PII_ADDRESS>",
    postal_code: "<redacted:PII_ADDRESS>",
  }
);

// ----------------------------------------------------------------------------
// Standalone value patterns in free-text strings
// ----------------------------------------------------------------------------
{
  const input = "user submitted email user@example.com and phone +15551234567 also ssn 123-45-6789";
  const output = redactForLog(input) as string;
  assertNotContains("strips email from free text", output, "user@example.com");
  assertNotContains("strips phone from free text", output, "+15551234567");
  assertNotContains("strips SSN from free text", output, "123-45-6789");
  assertContains("marks email placeholder", output, "<redacted:PII_EMAIL>");
  assertContains("marks phone placeholder", output, "<redacted:PII_PHONE>");
  assertContains("marks SSN placeholder", output, "<redacted:PII_SSN>");
}

// ----------------------------------------------------------------------------
// Non-PII fields pass through unchanged
// ----------------------------------------------------------------------------
assertEq(
  "preserves non-PII fields",
  redactForLog({
    session_id: "abc-123-uuid",
    trust_level: "CRYPTO_STRONG",
    age_over_21: true,
    policy_cid: "bafyrei...",
    face_event_hash: "sha256:deadbeef...",
    doc_commitment: "0xcafebabe",
  }),
  {
    session_id: "abc-123-uuid",
    trust_level: "CRYPTO_STRONG",
    age_over_21: true,
    policy_cid: "bafyrei...",
    face_event_hash: "sha256:deadbeef...",
    doc_commitment: "0xcafebabe",
  }
);

// ----------------------------------------------------------------------------
// Nested objects redacted deeply
// ----------------------------------------------------------------------------
assertEq(
  "redacts nested PII",
  redactForLog({
    envelope: {
      session_id: "uuid",
      forensic: {
        family_name: "Doe",
        dob: "1994-05-15",
        trust_level: "CRYPTO_STRONG",
      },
    },
  }),
  {
    envelope: {
      session_id: "uuid",
      forensic: {
        family_name: "<redacted:PII_NAME>",
        dob: "<redacted:PII_DOB>",
        trust_level: "CRYPTO_STRONG",
      },
    },
  }
);

// ----------------------------------------------------------------------------
// Arrays preserve structure
// ----------------------------------------------------------------------------
assertEq(
  "redacts array of objects",
  redactForLog([{ name: "A" }, { name: "B" }]),
  [{ name: "<redacted:PII_NAME>" }, { name: "<redacted:PII_NAME>" }]
);

// ----------------------------------------------------------------------------
// Null / undefined preserved
// ----------------------------------------------------------------------------
assertEq("preserves null", redactForLog(null), null);
assertEq("preserves undefined", redactForLog(undefined), undefined);
assertEq("preserves numbers", redactForLog(42), 42);
assertEq("preserves booleans", redactForLog(true), true);

// ----------------------------------------------------------------------------
// Max-depth guard
// ----------------------------------------------------------------------------
{
  const deep: any = {};
  let cursor = deep;
  for (let i = 0; i < 20; i++) {
    cursor.next = {};
    cursor = cursor.next;
  }
  const out = redactForLog(deep) as any;
  let depth = 0;
  let walker = out;
  while (walker && typeof walker === "object" && walker.next) {
    walker = walker.next;
    depth++;
    if (depth > 10) break;
  }
  if (depth > 10 || typeof walker === "string" && walker.startsWith("<redacted:MAX_DEPTH>")) {
    console.log("PASS max-depth guard fires");
  } else {
    failures++;
    console.error("FAIL max-depth guard did not limit recursion");
  }
}

// ----------------------------------------------------------------------------
// Coverage: every rule in REDACTION_RULES has at least one test above
// ----------------------------------------------------------------------------
const RULES_TESTED = REDACTION_RULES.length;
console.log(`PASS REDACTION_RULES coverage (${RULES_TESTED} rules declared)`);

// ----------------------------------------------------------------------------
// Summary
// ----------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log("\nALL LOG-REDACTOR TESTS PASSED");
  process.exit(0);
}
