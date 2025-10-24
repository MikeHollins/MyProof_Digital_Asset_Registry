/**
 * Test script for JWS verification
 * Generates a sample JWS token and tests registration with verification
 */

import { SignJWT, generateKeyPair, exportJWK } from "jose";

async function generateTestJWS() {
  console.log("Generating test JWS token with embedded JWK...\n");

  // Generate ES256 key pair (ECDSA with P-256 and SHA-256)
  const { publicKey, privateKey } = await generateKeyPair("ES256");

  // Export public key as JWK
  const publicJwk = await exportJWK(publicKey);

  console.log("Public JWK:", JSON.stringify(publicJwk, null, 2));

  // Create JWT payload (simulating a verifiable credential)
  const payload = {
    iss: "did:example:issuer123",
    sub: "did:example:subject456",
    aud: "did:example:verifier789",
    exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
    iat: Math.floor(Date.now() / 1000),
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential"],
      credentialSubject: {
        id: "did:example:subject456",
        degree: {
          type: "BachelorDegree",
          name: "Bachelor of Science in Computer Science",
        },
      },
    },
  };

  // Sign JWT with embedded JWK in header
  const jws = await new SignJWT(payload)
    .setProtectedHeader({
      alg: "ES256",
      typ: "JWT",
      jwk: publicJwk, // Embed public key in header
    })
    .sign(privateKey);

  console.log("\nGenerated JWS (compact serialization):");
  console.log(jws);
  console.log("\nJWS length:", jws.length);

  // Verify parts
  const parts = jws.split(".");
  console.log("\nJWS structure validation:");
  console.log("- Header length:", parts[0].length);
  console.log("- Payload length:", parts[1].length);
  console.log("- Signature length:", parts[2].length);

  return { jws, publicJwk };
}

async function testProofRegistration(jws: string) {
  console.log("\n\n=== Testing Proof Registration ===\n");

  const proofAsset = {
    issuerDid: "did:example:issuer123",
    subjectBinding: "did:example:subject456",
    proofFormat: "JWS",
    proofDigest: "test_digest_" + Date.now(),
    digestAlg: "sha2-256",
    constraintHash: crypto.randomUUID(),
    policyHash: crypto.randomUUID(),
    policyCid: `bagaaiera${crypto.randomUUID().replace(/-/g, "")}`,
    verifier_proof_ref: {
      proof_format: "JWS",
      proof_uri: jws, // Pass the JWS as proof_uri
      proof_digest: "test_digest_" + Date.now(),
      digest_alg: "sha2-256",
    },
  };

  console.log("Sending proof registration request...");

  try {
    const response = await fetch("http://localhost:5000/api/proof-assets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(proofAsset),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("\nRegistration failed:");
      console.error(JSON.stringify(error, null, 2));
      return null;
    }

    const result = await response.json();
    console.log("\n✓ Registration successful!");
    console.log("\nResponse:");
    console.log(JSON.stringify(result, null, 2));

    // Highlight verification metadata
    console.log("\n=== Verification Metadata ===");
    console.log("Status:", result.verificationStatus);
    console.log("Algorithm:", result.verificationAlgorithm);
    console.log(
      "Public Key Digest:",
      result.verificationPublicKeyDigest?.slice(0, 32) + "..."
    );
    console.log(
      "Verified At:",
      result.verificationTimestamp
        ? new Date(result.verificationTimestamp).toISOString()
        : "N/A"
    );

    if (result.verificationMetadata) {
      console.log(
        "\nDerived Facts:",
        JSON.stringify(result.verificationMetadata, null, 2)
      );
    }

    return result;
  } catch (error) {
    console.error("\nError during registration:", error);
    return null;
  }
}

async function main() {
  console.log("===========================================");
  console.log("  JWS Verification End-to-End Test");
  console.log("===========================================\n");

  // Generate test JWS
  const { jws } = await generateTestJWS();

  // Wait a bit for server to be ready
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Test registration with verification
  await testProofRegistration(jws);

  console.log("\n===========================================");
  console.log("  Test Complete");
  console.log("===========================================\n");
}

main().catch(console.error);
