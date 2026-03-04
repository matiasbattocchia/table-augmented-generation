import { readRange } from './lib/google.ts';
import { getRowHashes, upsertRowHashes, deleteRowHashes } from './db/index.ts';

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

function buildRowContent(headers: string[], row: string[]): string {
  return headers
    .map((h, i) => `${h}: ${row[i] ?? ''}`)
    .filter((_, i) => row[i] !== undefined && row[i] !== '')
    .join(' | ');
}

function vectorId(spreadsheetId: string, sheetName: string, rowNum: number): string {
  return `${spreadsheetId}:${sheetName}:${rowNum}`;
}

export interface IndexResult {
  indexed: number;
  deleted: number;
  unchanged: number;
}

export async function indexSheet(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  env: { DB: D1Database; VECTORIZE: VectorizeIndex; AI: Ai }
): Promise<IndexResult> {
  // 1. Fetch sheet data
  const data = await readRange(accessToken, spreadsheetId, sheetName);
  const rows = data.values ?? [];

  if (rows.length < 2) {
    return { indexed: 0, deleted: 0, unchanged: 0 };
  }

  const headers = rows[0];
  const prefix = `${spreadsheetId}:${sheetName}:`;

  // 2. Build content + hash for each data row
  const currentRows = new Map<string, { content: string; hash: string }>();
  for (let i = 1; i < rows.length; i++) {
    const content = buildRowContent(headers, rows[i]);
    if (!content) continue;
    const id = vectorId(spreadsheetId, sheetName, i + 1); // 1-indexed row numbers
    currentRows.set(id, { content, hash: djb2(content) });
  }

  // 3. Load existing hashes from DB
  const existingHashes = await getRowHashes(env.DB, prefix);
  const existingMap = new Map(existingHashes.map(r => [r.vector_id, r.content_hash]));

  // 4. Diff
  const toEmbed: { id: string; content: string }[] = [];
  const toDeleteIds: string[] = [];
  let unchanged = 0;

  for (const [id, { content, hash }] of currentRows) {
    if (existingMap.get(id) === hash) {
      unchanged++;
    } else {
      toEmbed.push({ id, content });
    }
  }

  for (const [id] of existingMap) {
    if (!currentRows.has(id)) {
      toDeleteIds.push(id);
    }
  }

  // 5. Delete removed rows
  if (toDeleteIds.length > 0) {
    await env.VECTORIZE.deleteByIds(toDeleteIds);
    await deleteRowHashes(env.DB, toDeleteIds);
  }

  // 6. Embed and upsert new/changed rows (batch up to 100)
  if (toEmbed.length > 0) {
    const batchSize = 100;
    for (let i = 0; i < toEmbed.length; i += batchSize) {
      const batch = toEmbed.slice(i, i + batchSize);
      const texts = batch.map(r => r.content);

      const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: texts }) as { data: number[][] };

      const vectors = batch.map((r, j) => ({
        id: r.id,
        values: embeddingResult.data[j],
        metadata: {
          spreadsheetId,
          sheetName,
          rowNumber: parseInt(r.id.split(':').pop()!),
          content: r.content,
        },
      }));

      await env.VECTORIZE.upsert(vectors);

      await upsertRowHashes(
        env.DB,
        batch.map(r => ({
          vector_id: r.id,
          content_hash: currentRows.get(r.id)!.hash,
        }))
      );
    }
  }

  return { indexed: toEmbed.length, deleted: toDeleteIds.length, unchanged };
}
