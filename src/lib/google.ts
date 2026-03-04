const SHEETS_API = 'https://sheets.googleapis.com/v4';

async function googleFetch(url: string, accessToken: string): Promise<Response> {
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google API error (${response.status}): ${error}`);
  }
  return response.json();
}

export interface Spreadsheet {
  spreadsheetId: string;
  properties: { title: string };
  sheets: {
    properties: { sheetId: number; title: string; index: number };
  }[];
}

export interface SheetValues {
  range: string;
  majorDimension: string;
  values: string[][];
}

export async function getSpreadsheet(accessToken: string, spreadsheetId: string): Promise<Spreadsheet> {
  const fields = 'spreadsheetId,properties.title,sheets.properties';
  const response = await googleFetch(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`,
    accessToken
  );
  return handleResponse<Spreadsheet>(response);
}

export async function readRange(accessToken: string, spreadsheetId: string, range: string): Promise<SheetValues> {
  const response = await googleFetch(
    `${SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
    accessToken
  );
  return handleResponse<SheetValues>(response);
}
