// Type declarations for the esbuild-bundled server at runtime path `../dist/index.js`.
// esbuild does not emit `.d.ts` files alongside its bundle output, so this ambient
// module declaration mirrors the actual exports from `server/index.ts` and
// `server/services/jti-repo.ts`. If those exports change, update this file to match.
//
// Verified against:
//   server/index.ts            : exports `app` (Express), `initApp` (() => Promise<void>)
//   server/services/jti-repo.ts: exports `cleanupExpiredJti` (() => Promise<number>)

declare module "../dist/index.js" {
    import type { Express } from "express";
    export const app: Express;
    export function initApp(): Promise<void>;
    export function cleanupExpiredJti(): Promise<number>;
}
