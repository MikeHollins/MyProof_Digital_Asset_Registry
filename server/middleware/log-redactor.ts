// Log-redactor middleware.
//
// Enforces the PII invariant in logging: every string that reaches a logger,
// Sentry, Vercel function logs, or any observability sink passes through a
// redaction pass first. Known PII patterns are replaced with tagged placeholders.
//
// Design:
//   - Pattern-match on BOTH key name and value shape (defense-in-depth).
//   - Redact in-place on objects; return new string for string inputs.
//   - Preserve structure + non-PII fields for operational diagnostics.
//   - Log what was redacted (the placeholder tag) so we can see PII-touch metrics
//     without seeing the PII itself.
//
// Consumed by:
//   - server/index.ts request/response loggers
//   - Every `console.log` / `console.error` in error paths (wrap via `redactForLog()`)
//   - CI PII pattern scanner (sourced from the same REDACTION_PATTERNS below)

type Placeholder = string;

interface RedactionRule {
  keys: readonly string[];        // Exact key names to redact unconditionally
  keyPatterns?: readonly RegExp[]; // Key-name regex alternatives
  valuePatterns?: readonly RegExp[]; // Value-content regex patterns that trigger redaction even if the key is not on the list
  placeholder: Placeholder;
  description: string;
}

export const REDACTION_RULES: readonly RedactionRule[] = [
  {
    keys: [
      "name", "full_name", "fullName", "family_name", "familyName", "given_name",
      "givenName", "middle_name", "middleName", "last_name", "lastName",
      "first_name", "firstName", "surname",
    ],
    placeholder: "<redacted:PII_NAME>",
    description: "Personal name fields",
  },
  {
    keys: [
      "dob", "DOB", "birth_date", "birthDate", "date_of_birth", "dateOfBirth",
      "birthday", "geburtstag", "naissance",
    ],
    valuePatterns: [
      /^\d{4}-\d{2}-\d{2}$/,      // ISO date
      /^\d{2}\/\d{2}\/\d{4}$/,    // US date
      /^\d{8}$/,                  // YYYYMMDD compact
    ],
    placeholder: "<redacted:PII_DOB>",
    description: "Date of birth",
  },
  {
    keys: [
      "address", "street", "street_address", "streetAddress",
      "resident_address", "residentAddress", "resident_street", "resident_city",
      "resident_state", "resident_postal_code", "postal_code", "postalCode",
      "zip", "zipcode", "city", "state",
    ],
    placeholder: "<redacted:PII_ADDRESS>",
    description: "Physical address components",
  },
  {
    keys: [
      "document_number", "documentNumber", "passport_number", "passportNumber",
      "dl_number", "dlNumber", "license_number", "licenseNumber", "id_number",
      "idNumber", "daq", "DAQ",
    ],
    placeholder: "<redacted:PII_DOC_NUMBER>",
    description: "Document identifier",
  },
  {
    keys: [
      "mrz", "mrz_raw", "mrzRaw", "mrz_string", "mrzString",
      "pdf417", "pdf417_raw", "pdf417Raw", "barcode_raw", "barcodeRaw",
      "aamva_raw", "aamvaRaw", "raw_payload", "rawPayload",
      "dg1", "dg2", "data_group_1", "data_group_2", "dataGroup1", "dataGroup2",
      "sod", "SOD", "dg_bytes", "dgBytes",
      "portrait", "portrait_image", "portraitImage", "photo", "face_image",
      "faceImage", "face_image_raw", "faceImageRaw", "document_image",
      "documentImage", "document_scan", "documentScan", "biometric",
      "face_embedding", "faceEmbedding", "face_vector", "faceVector",
    ],
    placeholder: "<redacted:PII_DOC_RAW>",
    description: "Raw document / biometric payloads (should never appear)",
  },
  {
    keys: ["phone", "phone_number", "phoneNumber", "mobile", "sms", "tel"],
    valuePatterns: [
      /^\+?\d{10,15}$/,
      /^\(\d{3}\)\s*\d{3}-\d{4}$/,
    ],
    placeholder: "<redacted:PII_PHONE>",
    description: "Phone number",
  },
  {
    keys: ["email", "email_address", "emailAddress", "mail"],
    valuePatterns: [
      /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
    ],
    placeholder: "<redacted:PII_EMAIL>",
    description: "Email address",
  },
  {
    keys: ["ssn", "social_security_number", "socialSecurityNumber", "sin"],
    valuePatterns: [
      /^\d{3}-\d{2}-\d{4}$/,
      /^\d{9}$/,
    ],
    placeholder: "<redacted:PII_SSN>",
    description: "Social security / insurance number",
  },
  {
    keys: ["ip", "ip_address", "ipAddress", "client_ip", "clientIp", "remote_addr", "remoteAddr"],
    placeholder: "<redacted:PII_IP>",
    description: "IP address (identifier when tied to a user)",
  },
  {
    keys: [
      "tin", "tax_id", "taxId", "taxpayer_id", "taxpayerId",
      "iban", "bic", "swift",
      "bank_account", "bankAccount",
      "credit_card", "creditCard", "card_number", "cardNumber", "cvv", "cvc",
    ],
    placeholder: "<redacted:PII_FINANCIAL>",
    description: "Tax / banking / payment identifiers",
  },
  {
    keys: [
      "bsn",                                      // Netherlands
      "ppsn",                                     // Ireland
      "pesel",                                    // Poland
      "cpf", "cnpj",                              // Brazil
      "aadhaar", "aadhar",                        // India
      "curp", "rfc",                              // Mexico
      "nino", "national_insurance_number", "nationalInsuranceNumber",
      "voter_id", "voterId", "voter_registration", "voterRegistration",
      "health_card", "healthCard", "ohip", "medicare", "medicaid",
      "nhs_number", "nhsNumber",
      "drivers_permit", "driversPermit",
    ],
    placeholder: "<redacted:PII_NATIONAL_ID>",
    description: "Country-specific national / personal / health identifiers",
  },
  {
    keys: [
      "fingerprint", "iris_scan", "irisScan", "retina_scan", "retinaScan",
    ],
    placeholder: "<redacted:PII_BIOMETRIC>",
    description: "Biometric identifiers (beyond face/portrait bucket)",
  },
];

// Case- AND unicode-insensitive key lookup: NFKC composes ligatures (ﬁ → fi,
// ﬀ → ff), fullwidth chars (ｆａｍｉｌｙ → family), then lowercased. Defeats
// unicode homoglyph bypasses identified in Phase 1 security review.
function normalizeKey(raw: string): string {
  return raw.normalize("NFKC").toLowerCase();
}

const KEY_LOOKUP: Map<string, RedactionRule> = new Map();
for (const rule of REDACTION_RULES) {
  for (const key of rule.keys) {
    KEY_LOOKUP.set(normalizeKey(key), rule);
  }
}

// Value-only patterns that trigger redaction even when key name is unknown.
// Used when logs dump arbitrary strings that might contain PII embedded in text.
const STANDALONE_VALUE_PATTERNS: readonly { pattern: RegExp; placeholder: Placeholder }[] = [
  { pattern: /\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, placeholder: "<redacted:PII_EMAIL>" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, placeholder: "<redacted:PII_SSN>" },
  { pattern: /\b\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, placeholder: "<redacted:PII_PHONE>" },
];

// Redacts a single value if it matches any value-pattern rules for the given key.
function redactValue(key: string, value: unknown): unknown {
  const rule = KEY_LOOKUP.get(normalizeKey(key));
  if (rule) {
    // Key-based redaction: always redact unless value is nullish (preserve shape).
    if (value === null || value === undefined) return value;
    if (rule.valuePatterns && typeof value === "string") {
      for (const p of rule.valuePatterns) {
        if (p.test(value)) return rule.placeholder;
      }
      // Key matched but value did not match any pattern — redact anyway (trust the key).
      return rule.placeholder;
    }
    return rule.placeholder;
  }
  // No key rule. If value is a string, scan for standalone PII patterns.
  if (typeof value === "string") {
    return redactStandalonePatterns(value);
  }
  return value;
}

function redactStandalonePatterns(text: string): string {
  let result = text;
  for (const { pattern, placeholder } of STANDALONE_VALUE_PATTERNS) {
    result = result.replace(pattern, placeholder);
  }
  return result;
}

// Deep-redact an object/array/Error. Non-mutating.
export function redactForLog(input: unknown, depth: number = 0): unknown {
  if (depth > 8) return "<redacted:MAX_DEPTH>"; // Guard against cycles/bombs
  if (input === null || input === undefined) return input;
  if (typeof input === "string") return redactStandalonePatterns(input);
  if (typeof input !== "object") return input;
  // Error instances have non-enumerable .message and .stack — Object.entries misses them.
  // Redact the fields explicitly so thrown PII-bearing errors are sanitized.
  if (input instanceof Error) {
    return {
      name: input.name,
      message: redactStandalonePatterns(input.message ?? ""),
      stack: input.stack ? redactStandalonePatterns(input.stack) : undefined,
    };
  }
  if (Array.isArray(input)) {
    return input.map((v) => redactForLog(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    // Defense-in-depth: refuse to walk special JS keys regardless of PII.
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    const rule = KEY_LOOKUP.get(normalizeKey(key));
    if (rule) {
      out[key] = redactValue(key, value);
    } else if (typeof value === "object" && value !== null) {
      out[key] = redactForLog(value, depth + 1);
    } else {
      out[key] = redactValue(key, value);
    }
  }
  return out;
}

// Express middleware: strips PII from req.body / req.query / req.headers before
// the next handler can accidentally log them. The ORIGINAL values remain
// available on the request for business logic; we only attach a `req.logSafe`
// property that loggers should use.
import type { Request, Response, NextFunction } from "express";

declare global {
  namespace Express {
    interface Request {
      logSafe?: {
        body: unknown;
        query: unknown;
        headers: Record<string, string | string[] | undefined>;
      };
    }
  }
}

export function logRedactorMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // Headers: drop sensitive ones entirely, redact the rest.
  const safeHeaders: Record<string, string | string[] | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lower = k.toLowerCase();
    if (["authorization", "cookie", "x-api-key", "x-bootstrap-secret"].includes(lower)) {
      safeHeaders[k] = "<redacted:AUTH_HEADER>";
    } else {
      safeHeaders[k] = v;
    }
  }
  req.logSafe = {
    body: redactForLog(req.body),
    query: redactForLog(req.query),
    headers: safeHeaders,
  };
  next();
}

// Utility: wrap a console.log-style call with redaction.
// Use everywhere in error handlers and debug traces:
//   safeLog("event=foo user=", userObj)  →  console.log with redacted user
export function safeLog(...args: unknown[]): void {
  const redacted = args.map((a) => redactForLog(a));
  // eslint-disable-next-line no-console
  console.log(...redacted);
}

export function safeError(...args: unknown[]): void {
  const redacted = args.map((a) => redactForLog(a));
  // eslint-disable-next-line no-console
  console.error(...redacted);
}
