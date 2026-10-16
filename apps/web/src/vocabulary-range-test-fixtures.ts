import { vi } from 'vitest';
// Keep public collection discovery separate from sequential game-response fixtures.
export function stubFetchWithVocabularyRanges(fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', (input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith('/word-lists/pools')?Promise.resolve(Response.json([])):fetchMock(input,init));
}
