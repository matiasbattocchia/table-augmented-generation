import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { getApiKeyRecord, updateTokens, isFileAuthorized } from './db/index.ts';
import { refreshAccessToken } from './lib/auth.ts';
import { getSpreadsheet } from './lib/google.ts';
import { indexSheet } from './indexer.ts';
import { search } from './searcher.ts';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Global error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: err.message || 'Internal server error' }, 500);
});

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});


const searchSchema = z.object({
  query: z.string().min(1),
  spreadsheet_id: z.string().min(1),
  sheet_names: z.array(z.string()).optional(),
  top_k: z.number().int().min(1).max(50).optional(),
});

// Search endpoint
app.post('/search', async (c) => {
  // 1. Auth: extract API key
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing Authorization: Bearer <api_key> header' }, 401);
  }
  const apiKey = authHeader.slice(7);

  // 2. Look up API key in google-mcp's D1
  const record = await getApiKeyRecord(c.env.GOOGLE_MCP_DB, apiKey, c.env.ENCRYPTION_KEY);
  if (!record) {
    return c.json({ error: 'Invalid or expired API key' }, 401);
  }

  // 3. Check sheets scope
  const scopes: string[] = JSON.parse(record.scopes);
  const hasSheetsScope = scopes.some(s => s.includes('drive') || s.includes('sheets'));
  if (!hasSheetsScope) {
    return c.json({ error: 'API key does not have Sheets/Drive scope' }, 403);
  }

  // 4. Parse request body
  let body: z.infer<typeof searchSchema>;
  try {
    body = searchSchema.parse(await c.req.json());
  } catch (e) {
    return c.json({ error: 'Invalid request', details: e instanceof z.ZodError ? e.issues : undefined }, 400);
  }

  // 5. Check file authorization (for drive.file scoped keys)
  const hasDriveFileScope = scopes.includes('https://www.googleapis.com/auth/drive.file');
  if (hasDriveFileScope) {
    const authorized = await isFileAuthorized(c.env.GOOGLE_MCP_DB, apiKey, body.spreadsheet_id);
    if (!authorized) {
      return c.json({ error: 'Spreadsheet not authorized for this API key' }, 403);
    }
  }

  // 6. Get spreadsheet metadata (also validates token)
  let accessToken = record.google_access_token;
  let spreadsheet;
  try {
    spreadsheet = await getSpreadsheet(accessToken, body.spreadsheet_id);
  } catch (e) {
    if (e instanceof Error && e.message.includes('401')) {
      // Token expired — refresh and retry
      const refreshed = await refreshAccessToken(
        record.google_refresh_token,
        c.env.GOOGLE_CLIENT_ID,
        c.env.GOOGLE_CLIENT_SECRET
      );
      accessToken = refreshed.access_token;
      await updateTokens(c.env.GOOGLE_MCP_DB, apiKey, { access_token: accessToken }, c.env.ENCRYPTION_KEY);
      spreadsheet = await getSpreadsheet(accessToken, body.spreadsheet_id);
    } else {
      throw e;
    }
  }

  // 7. Determine sheets to index
  const sheetNames = body.sheet_names?.length
    ? body.sheet_names
    : spreadsheet.sheets.map(s => s.properties.title);

  // 8. Index each sheet (diff-based, fast if unchanged)
  const indexResults = [];
  for (const sheetName of sheetNames) {
    const result = await indexSheet(accessToken, body.spreadsheet_id, sheetName, {
      DB: c.env.DB,
      VECTORIZE: c.env.VECTORIZE,
      AI: c.env.AI,
    });
    indexResults.push({ sheetName, ...result });
  }

  // 9. Search
  const results = await search(
    body.query,
    body.spreadsheet_id,
    { VECTORIZE: c.env.VECTORIZE, AI: c.env.AI },
    body.top_k ?? 10
  );

  return c.json({
    results,
    indexing: indexResults,
  });
});

export default app;
