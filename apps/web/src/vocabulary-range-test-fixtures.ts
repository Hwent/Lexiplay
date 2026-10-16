import { vi } from 'vitest';
// Keep public collection discovery separate from sequential game-response fixtures.
export function stubFetchWithVocabularyRanges(fetchMock: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal('fetch', (input:RequestInfo|URL,init?:RequestInit)=>{
    const path=String(input);
    if(path.endsWith('/collections'))return Promise.resolve(Response.json([]));
    if(path.endsWith('/games/wallet'))return Promise.resolve(Response.json({coinBalance:10,kind:'guest'}));
    if(path.endsWith('/library/revision'))return Promise.resolve(Response.json({}));
    return fetchMock(input,init);
  });
}
