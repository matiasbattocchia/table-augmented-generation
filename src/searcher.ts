export interface SearchResult {
  sheetName: string;
  rowNumber: number;
  content: string;
  score: number;
}

export async function search(
  query: string,
  spreadsheetId: string,
  env: { VECTORIZE: VectorizeIndex; AI: Ai },
  topK: number = 10
): Promise<SearchResult[]> {
  // 1. Embed query
  const embeddingResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [query] }) as { data: number[][] };
  const queryEmbedding = embeddingResult.data[0];

  // 2. Vector search with metadata filter
  const vectorResults = await env.VECTORIZE.query(queryEmbedding, {
    topK: 20,
    returnMetadata: 'all',
    filter: { spreadsheetId },
  });

  if (!vectorResults.matches || vectorResults.matches.length === 0) {
    return [];
  }

  // 3. Prepare candidates for reranking
  const candidates = vectorResults.matches
    .filter(m => m.metadata?.content)
    .map(m => ({
      sheetName: m.metadata!.sheetName as string,
      rowNumber: m.metadata!.rowNumber as number,
      content: m.metadata!.content as string,
      vectorScore: m.score,
    }));

  if (candidates.length === 0) return [];

  // 4. Rerank (generated types are missing `query` field — add via spread)
  const rerankResult = await env.AI.run('@cf/baai/bge-reranker-base', {
    ...{ query },
    contexts: candidates.map(c => ({ text: c.content })),
  } as Ai_Cf_Baai_Bge_Reranker_Base_Input);

  // 5. Merge rerank scores and sort
  const response = rerankResult.response ?? [];
  const reranked = response
    .filter((r): r is { id: number; score: number } => r.id !== undefined && r.score !== undefined)
    .map(r => ({
      sheetName: candidates[r.id].sheetName,
      rowNumber: candidates[r.id].rowNumber,
      content: candidates[r.id].content,
      score: r.score,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return reranked;
}
