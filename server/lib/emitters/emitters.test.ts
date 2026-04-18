// Smoke tests for Phase 4 credential emitters.
// Run: npx tsx server/lib/emitters/emitters.test.ts

import { importPKCS8, jwtVerify, createLocalJWKSet, type JSONWebKeySet } from "jose";
import { FileSigner } from "../signer.js";
import { issueSdJwtVc, SD_JWT_VC_HEADER_TYP } from "./sd-jwt-vc.js";
import { issueMdoc } from "./mdoc.js";

let failures = 0;
function pass(name: string): void { console.log(`PASS ${name}`); }
function fail(name: string, reason: string): void { failures++; console.error(`FAIL ${name}\n  ${reason}`); }

async function run(): Promise<void> {
  // Ephemeral signer for test.
  const { privateKeyPem, publicKeyPem, fingerprint } = FileSigner.generate();

  // --------------------------------------------------------------------
  // SD-JWT-VC: minimal predicate emission
  // --------------------------------------------------------------------
  const result = await issueSdJwtVc({
    issuer: "did:web:api.myproof.ai",
    sub: "verif-" + "a".repeat(16),
    audience: "partner-abc",
    vct: "https://schemas.myproof.ai/age-over-21/v1",
    claims: {
      age_over_21: true,
      jurisdiction_allowed: true,
      issuer_trusted: true,
      policy_cid: "sha256:" + "b".repeat(64),
      assurance_level: "maximum",
    },
    ttlSeconds: 3600,
    privateKeyPem,
    kid: fingerprint,
  });

  // Token shape: header.payload.signature, three base64url segments
  const parts = result.token.split(".");
  if (parts.length !== 3) fail("SD-JWT-VC token has 3 segments", `got ${parts.length}`);
  else pass("SD-JWT-VC token has 3 segments");

  // Verify signature via jose
  const pub = await importPKCS8(privateKeyPem, "EdDSA"); // reuse priv for test key
  // Actually use publicKeyPem via importSPKI for proper verification
  const { importSPKI, jwtVerify: verify } = await import("jose");
  const verifyKey = await importSPKI(publicKeyPem, "EdDSA");
  try {
    const { payload, protectedHeader } = await verify(result.token, verifyKey, {
      issuer: "did:web:api.myproof.ai",
      audience: "partner-abc",
      typ: SD_JWT_VC_HEADER_TYP,
    });
    if (payload.age_over_21 !== true) fail("age_over_21 in payload", `got ${payload.age_over_21}`);
    else pass("age_over_21 in payload");
    if (payload.vct !== "https://schemas.myproof.ai/age-over-21/v1") fail("vct in payload", "");
    else pass("vct in payload");
    if (!payload.jti || typeof payload.jti !== "string") fail("jti present", "");
    else pass("jti present");
    if (protectedHeader.alg !== "EdDSA") fail("alg = EdDSA", `got ${protectedHeader.alg}`);
    else pass("alg = EdDSA");
    if (protectedHeader.typ !== "dc+sd-jwt") fail("typ = dc+sd-jwt", `got ${protectedHeader.typ}`);
    else pass("typ = dc+sd-jwt");
    if (protectedHeader.kid !== fingerprint) fail("kid = signer fingerprint", `got ${protectedHeader.kid}`);
    else pass("kid = signer fingerprint");
    // Predicate-only: no PII attributes.
    for (const forbidden of ["birth_date", "family_name", "given_name", "portrait", "document_number"]) {
      if (payload[forbidden] !== undefined) fail(`SD-JWT-VC payload omits ${forbidden}`, "");
    }
    pass("SD-JWT-VC payload has no PII attributes");
  } catch (err) {
    fail("SD-JWT-VC verify", err instanceof Error ? err.message : String(err));
  }

  // --------------------------------------------------------------------
  // SD-JWT-VC: allowlist rejection of a forbidden claim
  // --------------------------------------------------------------------
  try {
    await issueSdJwtVc({
      issuer: "did:web:api.myproof.ai",
      sub: "verif-test",
      audience: "partner",
      vct: "https://schemas.myproof.ai/age-over-21/v1",
      claims: { birth_date: "1994-05-15" as any }, // Forbidden — should throw
      ttlSeconds: 60,
      privateKeyPem,
      kid: fingerprint,
    });
    fail("SD-JWT-VC rejects birth_date claim", "did not throw");
  } catch (err) {
    if (err instanceof Error && err.message.includes("birth_date")) {
      pass("SD-JWT-VC rejects birth_date claim");
    } else {
      fail("SD-JWT-VC rejects birth_date claim", `threw wrong error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // --------------------------------------------------------------------
  // mdoc: emit a minimal age_over_21 claim
  // --------------------------------------------------------------------
  const mdocResult = await issueMdoc({
    claims: { age_over_21: true },
    privateKeyPem,
    ttlSeconds: 3600,
    issuingAuthority: "did:web:api.myproof.ai",
  });
  if (mdocResult.docType !== "org.iso.18013.5.1.mDL") fail("mdoc docType", `got ${mdocResult.docType}`);
  else pass("mdoc docType = org.iso.18013.5.1.mDL");
  if (!mdocResult.elements.includes("age_over_21")) fail("mdoc contains age_over_21 element", "");
  else pass("mdoc contains age_over_21 element");
  if (mdocResult.issuer_signed_b64url.length < 200) fail("mdoc payload has meaningful size", `got len=${mdocResult.issuer_signed_b64url.length}`);
  else pass("mdoc payload has meaningful size (>=200 b64url chars)");

  // --------------------------------------------------------------------
  // mdoc: allowlist rejection of a forbidden element
  // --------------------------------------------------------------------
  try {
    await issueMdoc({
      claims: { birth_date: true as any },
      privateKeyPem,
      ttlSeconds: 60,
      issuingAuthority: "did:web:api.myproof.ai",
    });
    fail("mdoc rejects birth_date element", "did not throw");
  } catch (err) {
    if (err instanceof Error && err.message.includes("birth_date")) {
      pass("mdoc rejects birth_date element");
    } else {
      fail("mdoc rejects birth_date element", `threw wrong error: ${err instanceof Error ? err.message : err}`);
    }
  }

  // --------------------------------------------------------------------
  // mdoc: accept fully-qualified claim name as well
  // --------------------------------------------------------------------
  const mdocResult2 = await issueMdoc({
    claims: { "org.iso.18013.5.1.age_over_21": true } as any,
    privateKeyPem,
    ttlSeconds: 3600,
    issuingAuthority: "did:web:api.myproof.ai",
  });
  if (!mdocResult2.elements.includes("age_over_21")) {
    fail("mdoc accepts FQ claim name", `got elements=${mdocResult2.elements.join(",")}`);
  } else {
    pass("mdoc accepts fully-qualified claim name");
  }

  if (failures > 0) {
    console.error(`\n${failures} test(s) FAILED`);
    process.exit(1);
  }
  console.log("\nALL PHASE 4 EMITTER TESTS PASSED");
  process.exit(0);
}

run().catch((err) => {
  console.error("[emitters.test] fatal", err);
  process.exit(2);
});
