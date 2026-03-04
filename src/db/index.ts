import { decrypt, encrypt } from '../lib/crypto.ts';

// --- google-mcp DB operations (shared auth) ---

export interface ApiKeyRecord {
  api_key: string;
  google_access_token: string;
  google_refresh_token: string;
  scopes: string;
  expires_at: number | null;
  created_at: number;
}

export async function getApiKeyRecord(
  db: D1Database,
  apiKey: string,
  encryptionKey: string
): Promise<ApiKeyRecord | null> {
  const result = await db.prepare(`
    SELECT * FROM api_keys WHERE api_key = ?
  `).bind(apiKey).first<ApiKeyRecord>();

  if (!result) return null;

  // Check if expired
  if (result.expires_at && result.expires_at < Math.floor(Date.now() / 1000)) {
    return null;
  }

  // Decrypt tokens
  result.google_access_token = await decrypt(result.google_access_token, encryptionKey);
  result.google_refresh_token = await decrypt(result.google_refresh_token, encryptionKey);

  return result;
}

export async function updateTokens(
  db: D1Database,
  apiKey: string,
  tokens: { access_token: string; refresh_token?: string },
  encryptionKey: string
): Promise<void> {
  const accessToken = await encrypt(tokens.access_token, encryptionKey);

  if (tokens.refresh_token) {
    const refreshToken = await encrypt(tokens.refresh_token, encryptionKey);
    await db.prepare(`
      UPDATE api_keys SET google_access_token = ?, google_refresh_token = ? WHERE api_key = ?
    `).bind(accessToken, refreshToken, apiKey).run();
  } else {
    await db.prepare(`
      UPDATE api_keys SET google_access_token = ? WHERE api_key = ?
    `).bind(accessToken, apiKey).run();
  }
}

export async function isFileAuthorized(
  db: D1Database,
  apiKey: string,
  fileId: string
): Promise<boolean> {
  const result = await db.prepare(`
    SELECT 1 FROM authorized_files WHERE api_key = ? AND file_id = ? LIMIT 1
  `).bind(apiKey, fileId).first();

  return result !== null;
}

// --- TAG own DB operations (row hashes) ---

export interface RowHash {
  vector_id: string;
  content_hash: string;
}

export async function getRowHashes(db: D1Database, prefix: string): Promise<RowHash[]> {
  // Use range query instead of LIKE to avoid issues with _ wildcards in spreadsheet IDs
  const result = await db.prepare(`
    SELECT vector_id, content_hash FROM row_hashes
    WHERE vector_id >= ? AND vector_id < ?
  `).bind(prefix, prefix + '\uffff').all<RowHash>();

  return result.results ?? [];
}

export async function upsertRowHashes(db: D1Database, rows: RowHash[]): Promise<void> {
  for (const row of rows) {
    await db.prepare(`
      INSERT OR REPLACE INTO row_hashes (vector_id, content_hash) VALUES (?, ?)
    `).bind(row.vector_id, row.content_hash).run();
  }
}

export async function deleteRowHashes(db: D1Database, vectorIds: string[]): Promise<void> {
  for (const id of vectorIds) {
    await db.prepare(`
      DELETE FROM row_hashes WHERE vector_id = ?
    `).bind(id).run();
  }
}
