export const WORDNET_SOURCE = 'oewn-2025';
export const WORDNET_URL = 'https://en-word.net/static/english-wordnet-2025-json.zip';
export type DictionarySense = { partOfSpeech: string; definitions: string[]; source?: string; synsetIds?: string[]; senseIds?: string[] };
export type DictionaryRecord = { term: string; definition: string; partOfSpeech: string[]; senses: DictionarySense[] };
type WordnetSynset = { definition: string[]; partOfSpeech: string };
type WordnetPosition = { sense: { id: string; synset: string }[] };
export type WordnetLexicon = Record<string, Record<string, WordnetPosition>>;
export type WordnetSynsets = Record<string, WordnetSynset>;
const positions: Record<string, string> = { n: 'noun', v: 'verb', a: 'adjective', s: 'adjective', r: 'adverb' };

export function wordnetRecords(lexicon: WordnetLexicon, synsets: WordnetSynsets): DictionaryRecord[] {
  const records: DictionaryRecord[] = [];
  for (const [lemma, entry] of Object.entries(lexicon)) {
    const term = lemma.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!term || term.length > 100 || /[\u0000-\u001f\u007f]/.test(term)) continue;
    const groups = new Map<string, DictionarySense>();
    for (const [position, value] of Object.entries(entry)) {
      const partOfSpeech = positions[position.replace(/-\d+$/, '')];
      if (!partOfSpeech || !Array.isArray(value.sense)) throw new Error(`Unsupported WordNet entry format for ${term}.`);
      const group = groups.get(partOfSpeech) ?? { partOfSpeech, definitions: [], source: WORDNET_SOURCE, synsetIds: [], senseIds: [] };
      for (const sense of value.sense) {
        if (typeof sense?.id !== 'string' || typeof sense.synset !== 'string') throw new Error('WordNet senses require identifiers and synset references.');
        const synset = synsets[sense.synset];
        if (!synset || !Array.isArray(synset.definition) || positions[synset.partOfSpeech] !== partOfSpeech) throw new Error(`Missing or incompatible WordNet synset ${sense.synset}.`);
        for (const raw of synset.definition) {
          if (typeof raw !== 'string') throw new Error('WordNet definitions must be text.');
          const definition = raw.replace(/\s+/g, ' ').trim();
          if (definition && !group.definitions.includes(definition)) group.definitions.push(definition);
        }
        group.synsetIds!.push(sense.synset); group.senseIds!.push(sense.id);
      }
      if (group.definitions.length) groups.set(partOfSpeech, group);
    }
    const senses = [...groups.values()];
    if (senses.length) records.push({ term, definition: senses.map(sense => sense.definitions.join('; ')).join('\n'), partOfSpeech: senses.map(sense => sense.partOfSpeech), senses });
  }
  return records;
}

function displayDefinition(senses: DictionarySense[]) {
  return senses.map(sense => (senses.length > 1 ? sense.partOfSpeech + ': ' : '') + sense.definitions.join('; ')).join('\n');
}

// Preserve useful existing senses. WordNet fills only absent/empty POS groups.
// Full WordNet meanings and identifiers are retained separately in provenance.
export function supplementDictionary(existing: DictionaryRecord | undefined, incoming: DictionaryRecord): { record: DictionaryRecord; changed: boolean } {
  const senses = (existing?.senses ?? []).map(sense => ({ ...sense, definitions: [...sense.definitions] }));
  let changed = !existing;
  for (const sense of incoming.senses) {
    const index = senses.findIndex(current => current.partOfSpeech === sense.partOfSpeech);
    if (index >= 0 && senses[index]!.definitions.some(definition => definition.trim())) continue;
    const selected = { ...sense, definitions: sense.definitions.slice(0, 2) };
    if (index >= 0) senses[index] = selected; else senses.push(selected);
    changed = true;
  }
  const partOfSpeech = [...new Set([...(existing?.partOfSpeech ?? []), ...senses.map(sense => sense.partOfSpeech)])];
  const definition = existing?.definition.trim() ? existing.definition : displayDefinition(senses);
  if (existing && definition !== existing.definition) changed = true;
  if (existing && JSON.stringify(partOfSpeech) !== JSON.stringify(existing.partOfSpeech)) changed = true;
  if (!changed && existing) return { record: existing, changed: false };
  return { record: { term: existing?.term ?? incoming.term, definition, partOfSpeech, senses }, changed };
}
