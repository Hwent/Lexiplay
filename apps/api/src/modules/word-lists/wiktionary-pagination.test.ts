import { describe, expect, it } from 'vitest';
import { applyContinuation } from './wiktionary-pagination';

describe('Wiktionary API continuation', () => {
  it('uses only the continuation values returned by the latest API response', () => {
    const params = new URLSearchParams({ action: 'query', generator: 'allpages' });
    let previousKeys = applyContinuation(params, [], {
      continue: '||',
      gapcontinue: 'page cursor',
    });

    previousKeys = applyContinuation(params, previousKeys, {
      continue: '||',
      excontinue: 'extract cursor',
    });

    expect(params.has('gapcontinue')).toBe(false);
    expect(params.get('excontinue')).toBe('extract cursor');
    expect(previousKeys).toEqual(['continue', 'excontinue']);
  });
});
