import { vi } from 'vitest';
// Compatibility helper for existing tests; practice no longer requests ranges.
export function stubFetchWithVocabularyRanges(fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', fetchMock);
}
