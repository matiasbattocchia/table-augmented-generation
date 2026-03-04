# TAG — Table-Augmented Generation

Semantic search over Google Sheets. Find rows by meaning, not exact match.

Deployed at `https://tag.openbsp.dev`

## How it works

1. Receives a search query + spreadsheet ID
2. Fetches sheet data via Google Sheets API
3. Indexes rows using AI embeddings (diff-based — only re-embeds changes)
4. Searches using vector similarity + reranking
5. Returns top matching rows with relevance scores

## API

```bash
curl -X POST https://tag.openbsp.dev/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer gmc_..." \
  -d '{
    "query": "payments over 1000 in January",
    "spreadsheet_id": "abc123",
    "sheet_names": ["Sheet1"],
    "top_k": 10
  }'
```

Authentication uses [google-mcp](https://github.com/matiasbattocchia/google-mcp) API keys.

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `query` | Yes | Natural language search query |
| `spreadsheet_id` | Yes | Google Sheets spreadsheet ID |
| `sheet_names` | No | Sheets to search (default: all) |
| `top_k` | No | Number of results (default: 10, max: 50) |

## Stack

- Cloudflare Workers + D1 + Vectorize + Workers AI
- Embeddings: `bge-base-en-v1.5` (768 dimensions)
- Reranking: `bge-reranker-base`
- Hono + Zod

## Development

```bash
npm install
npm run dev          # starts on port 8788
npm run typecheck    # type check
npm run deploy       # deploy to Cloudflare
```

Requires `.dev.vars` with `ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
