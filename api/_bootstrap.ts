// CONTAINMENT FILE FOR THE UNTYPED dist/index.js BUNDLE.
//
// esbuild does not emit .d.ts files alongside its bundle output, and Vercel's
// per-function TypeScript compile does not honor ambient declarations (.d.ts)
// or triple-slash references in adjacent files. The only working pattern is
// to import the untyped bundle in ONE file with an explicit @ts-expect-error,
// re-export with manually typed assertions, and have all other api/ functions
// import from this wrapper.
//
// The leading underscore in the filename tells Vercel this is NOT a serverless
// function endpoint, so it is not exposed as a Lambda route.
//
// Type assertions verified against:
//   server/index.ts            : exports `app` (Express), `initApp` (() => Promise<void>)
//   server/services/jti-repo.ts: exports `cleanupExpiredJti` (() => Promise<number>)
//
// If those exports change, update the assertions below to match.

import type { Express } from "express";

// @ts-expect-error -- esbuild bundle has no companion .d.ts; types verified manually above
import * as bundle from "../dist/index.js";

export const app = bundle.app as Express;
export const initApp = bundle.initApp as () => Promise<void>;
export const cleanupExpiredJti = bundle.cleanupExpiredJti as () => Promise<number>;
