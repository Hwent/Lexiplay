export type DefinitionRecord = { language: string; definition: string; senseIndex: number; reviewStatus: string };
export function displayedDefinition(custom: string | null | undefined, customLanguage: string | null | undefined,
  preferredLanguage: string, records: DefinitionRecord[], english: string | null) {
  if (custom?.trim()) return { definition: custom, language: customLanguage || preferredLanguage, definitionSource: 'custom' };
  const approved = records.filter(record => record.reviewStatus === 'approved').sort((a,b) => a.senseIndex-b.senseIndex);
  for (const language of [...new Set([preferredLanguage,'en'])]) {
    const meanings = approved.filter(record => record.language === language).map(record => record.definition.trim()).filter(Boolean);
    if (meanings.length) return { definition: meanings.join('; '), language, definitionSource: 'dictionary' };
    if (language === 'en' && english?.trim()) return { definition: english, language: 'en', definitionSource: 'dictionary' };
  }
  return { definition: null, language: null, definitionSource: null };
}
