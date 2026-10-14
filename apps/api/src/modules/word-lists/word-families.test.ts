import { describe, expect, it } from 'vitest';
import { familyCounts, groupFamilies, wordFamily } from './word-families';
import { CEFR_POOLS } from './cefr-pools';

describe('published word families',()=>{
  it('groups explicit derivations while keeping separate member identities',()=>{
    const words=['action','actor','actress'];
    const groups=groupFamilies(words,word=>word);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({headword:'act',kind:'family',members:words});
    expect(familyCounts(words)).toEqual({familyCount:1,otherUnitCount:0});
  });
  it('keeps unmapped words and phrases explicit instead of inventing a root',()=>{
    expect(wordFamily('ice cream').kind).toBe('phrase');
    expect(wordFamily('invented-new-form').kind).toBe('unclassified');
    expect(familyCounts(['ice cream','invented-new-form','action','actor'])).toEqual({familyCount:1,otherUnitCount:2});
  });
  it('maps every C2 member without assigning its level to related words',()=>{
    const c2=CEFR_POOLS.find(pool=>pool.level==='C2')!;
    expect(c2.words).toHaveLength(942);
    expect(c2.words.every(word=>wordFamily(word.term).kind==='family')).toBe(true);
    expect(familyCounts(c2.words.map(word=>word.term))).toEqual({familyCount:731,otherUnitCount:0});
    expect(CEFR_POOLS.find(pool=>pool.level==='A1')!.words.some(word=>word.term==='action')).toBe(true);
    expect(CEFR_POOLS.find(pool=>pool.level==='A2')!.words.some(word=>word.term==='act')).toBe(true);
  });
});
