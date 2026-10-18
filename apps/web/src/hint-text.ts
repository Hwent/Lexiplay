const sentences = new Intl.Segmenter('en', { granularity: 'sentence' });

export function definitionHintText(text: string) {
  const firstMeaning = text.split(/[;\n]/, 1)[0]!.trim();
  return [...sentences.segment(firstMeaning)][0]?.segment.trim() ?? '';
}
