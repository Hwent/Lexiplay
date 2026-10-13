export type PasteFormat = 'words' | 'meanings';

export function preparePastedWords(text: string, format: PasteFormat): string {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').replace(/[’‘]/g, "'");
  const entries = format === 'words' ? normalized.split(/[\n,;\t]+/) : normalized.split('\n');
  return entries.map(entry => entry.trim().replace(/^(?:[-*•]\s+|\d+[.)]\s*)/, '').trim())
    .filter(Boolean).join('\n');
}
