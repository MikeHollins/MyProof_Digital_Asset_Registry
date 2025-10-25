import type { Express, Request, Response } from "express";
import { ensureList, getCompressedBitstring } from "./services/status-list-repo";

/**
 * Status List Routes
 * 
 * Serves W3C Bitstring Status Lists from PostgreSQL database.
 * These lists persist across server restarts.
 * 
 * Spec: https://www.w3.org/TR/vc-bitstring-status-list/
 */

export function registerStatusListRoutes(app: Express) {
  /**
   * GET /status/lists/:purpose/:listId
   * 
   * Serves a W3C Bitstring Status List from the database.
   * 
   * - purpose: 'revocation' | 'suspension'
   * - listId: Identifier for the list (e.g., 'demo-001')
   * 
   * Returns:
   * - 200: W3C BitstringStatusListCredential (JSON)
   * - 404: Status list not found
   * - 304: Not modified (if ETag matches If-None-Match header)
   */
  app.get('/status/lists/:purpose/:listId', async (req: Request, res: Response) => {
    try {
      const { purpose, listId } = req.params;
      
      // Validate purpose
      if (purpose !== 'revocation' && purpose !== 'suspension') {
        return res.status(400).json({
          error: 'invalid_purpose',
          message: 'Purpose must be either "revocation" or "suspension"',
        });
      }

      // Construct full URL for this status list
      const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
      const statusListUrl = `${baseUrl}/status/lists/${purpose}/${listId}`;

      // Ensure the list exists (creates if not)
      await ensureList(statusListUrl, purpose as 'revocation' | 'suspension');

      // Get compressed bitstring from database
      const result = await getCompressedBitstring(statusListUrl);
      
      if (!result) {
        return res.status(404).json({
          error: 'status_list_not_found',
          message: `Status list not found: ${statusListUrl}`,
        });
      }

      // Check ETag for conditional requests (cache optimization)
      const inm = req.headers['if-none-match'];
      if (inm && result.etag && inm === result.etag) {
        return res.status(304).end();
      }

      // Set caching headers
      if (result.etag) {
        res.setHeader('ETag', result.etag);
      }
      res.setHeader('Cache-Control', 'no-store'); // Don't cache (status may change)

      // Return W3C Bitstring Status List format
      return res.json({
        "@context": ["https://www.w3.org/ns/credentials/v2"],
        id: statusListUrl,
        type: "BitstringStatusListCredential",
        credentialSubject: {
          id: `${statusListUrl}#list`,
          type: "BitstringStatusList",
          encodedList: result.bitstring, // Already base64-encoded gzipped data
          statusPurpose: purpose,
        },
      });

    } catch (error: any) {
      console.error('[status-list] Error serving status list:', error);
      return res.status(500).json({
        error: 'internal_error',
        message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      });
    }
  });
}
