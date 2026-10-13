import { describe, expect, it } from 'vitest';
import { preparePastedWords } from './pasted-word-import';

describe('pasted word preparation', () => {
  it('accepts commas, tabs, new lines, semicolons, bullets and numbered lists', () => {
    expect(preparePastedWords('\uFEFF• apple, brave\r\n1. curious\t2) well-being;\n- can’t\n* ice cream\n', 'words'))
      .toBe("apple\nbrave\ncurious\nwell-being\ncan't\nice cream");
  });

  it('preserves punctuation and tabs inside meanings and removes only list prefixes', () => {
    expect(preparePastedWords('1. apple — A fruit, often red; also green.\r\n• brave: showing courage\nwell-being\tGood health\n', 'meanings'))
      .toBe('apple — A fruit, often red; also green.\nbrave: showing courage\nwell-being\tGood health');
  });

  it('ignores blank entries without discarding invalid terms that need review', () => {
    expect(preparePastedWords(' , \n\t; ', 'words')).toBe('');
    expect(preparePastedWords('word,bad123,word', 'words')).toBe('word\nbad123\nword');
  });
});
