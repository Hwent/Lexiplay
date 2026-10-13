import { vi } from 'vitest';
import type { VocabularyRangeOption } from './useVocabularyRanges';

const counts = Object.fromEntries([3, 4, 5, 6, 7, 8, 9].map(length => [length, 30]));
export const TEST_VOCABULARY_RANGES: VocabularyRangeOption[] = [
  { id: 'all', label: 'All vocabulary', description: 'Explore the full game dictionary.', wordCounts: counts },
  { id: 'primary', label: 'Primary school', description: 'Everyday and school words.', wordCounts: { ...counts, 5: 12 } },
  { id: 'grade-12', label: 'Grade 12', description: 'Senior-school vocabulary.', wordCounts: counts },
  { id: 'ielts', label: 'IELTS practice', description: 'Academic vocabulary.', wordCounts: { ...counts, 5: 2 } },
  { id: 'cefr-a1-a2', label: 'CEFR A1–A2', description: 'Basic practice.', wordCounts: counts },
  { id: 'cefr-b1-b2', label: 'CEFR B1–B2', description: 'Independent practice.', wordCounts: counts },
  { id: 'cefr-c1-c2', label: 'CEFR C1–C2', description: 'Advanced practice.', wordCounts: { ...Object.fromEntries([3, 4, 5, 6, 7, 8].map(length => [length, 0])), 9: 2 } },
];

// Keep unrelated game/account mocks focused on their existing requests.
export function stubFetchWithVocabularyRanges(fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/games/vocabulary-ranges')
    ? Promise.resolve(Response.json(TEST_VOCABULARY_RANGES)) : fetchMock(input, init));
}
