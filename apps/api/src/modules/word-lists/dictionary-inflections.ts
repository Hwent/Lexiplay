export const inflectionLabels = {
  plural: 'Plural', past: 'Past tense', past_participle: 'Past participle',
  present_participle: 'Present participle', third_person_singular: 'Third person singular',
  comparative: 'Comparative', superlative: 'Superlative', verb_form: 'Inflected form',
} as const;
export type InflectionKind = keyof typeof inflectionLabels;
export type Inflection = { form: string; base: string; partOfSpeech: string; kind: InflectionKind; source: string; sourceRef: string };

const labels: Record<string, InflectionKind[]> = {
  plural: ['plural'], 'simple past': ['past'], past: ['past'], 'past tense': ['past'],
  'past participle': ['past_participle'], 'past tense and participle': ['past', 'past_participle'],
  'past tense and past participle': ['past', 'past_participle'],
  'present participle': ['present_participle'], 'gerund participle': ['present_participle'],
  'third person singular': ['third_person_singular'], 'third person singular present': ['third_person_singular'],
  comparative: ['comparative'], superlative: ['superlative'],
};

export function definitionInflections(form: string, partOfSpeech: string, definition: string): Inflection[] {
  const match = /^([a-z -]+) of (.+?)(?:\.\s|\.$|$)/i.exec(definition.trim());
  if (!match) return [];
  const kinds = labels[match[1]!.toLowerCase().replace(/-/g, ' ')];
  if (!kinds) return [];
  const base = match[2]!.trim();
  return kinds.filter(kind => kind === 'plural' ? partOfSpeech === 'noun'
    : ['comparative', 'superlative'].includes(kind) ? ['adjective', 'adverb'].includes(partOfSpeech)
    : partOfSpeech === 'verb').map(kind => ({ form, base, partOfSpeech, kind, source: 'local-dictionary', sourceRef: definition }));
}

type WebsterEntry = {
  meta?: { id?: string; stems?: string[] };
  hwi?: { hw?: string };
  fl?: string;
  ins?: { if?: string; il?: string }[];
};
const spelling = (value: string) => value.replace(/\*/g, '').normalize('NFC').trim();

// Stems also contain derivatives and idioms. Admit only attested regular inflections.
function regularForms(base: string, pos: string): Map<string, InflectionKind[]> {
  const forms = new Map<string, InflectionKind[]>();
  const third = /[^aeiou]y$/.test(base) ? base.slice(0, -1) + 'ies' : /(?:s|sh|ch|x|z)$/.test(base) ? base + 'es' : base + 's';
  if (pos === 'noun') forms.set(third, ['plural']);
  if (pos === 'verb') {
    forms.set(third, ['third_person_singular']);
    const past = /[^aeiou]y$/.test(base) ? base.slice(0, -1) + 'ied' : base.endsWith('e') ? base + 'd' : base + 'ed';
    forms.set(past, ['past', 'past_participle']);
    forms.set(base.endsWith('ie') ? base.slice(0, -2) + 'ying' : /[^e]e$/.test(base) ? base.slice(0, -1) + 'ing' : base + 'ing', ['present_participle']);
    if (/[aeiou][bcdfghjklmnpqrstvyz]$/.test(base)) {
      forms.set(base + base.at(-1) + 'ed', ['past', 'past_participle']);
      forms.set(base + base.at(-1) + 'ing', ['present_participle']);
    }
  }
  return forms;
}

export function websterInflections(response: unknown, requestedTerm?: string): Inflection[] {
  if (!Array.isArray(response)) throw new Error('Dictionary API did not return a JSON array.');
  const result = new Map<string, Inflection>();
  for (const value of response) {
    if (!value || typeof value !== 'object') continue; // String arrays are spelling suggestions.
    const entry = value as WebsterEntry;
    const pos = entry.fl === 'transitive verb' || entry.fl === 'intransitive verb' ? 'verb' : entry.fl;
    if (!pos || !['noun', 'verb', 'adjective', 'adverb'].includes(pos) || !entry.hwi?.hw || !entry.meta?.id) continue;
    const base = spelling(entry.hwi.hw);
    if (requestedTerm && base.toLowerCase() !== requestedTerm.toLowerCase()) continue;
    const regular = regularForms(base, pos);
    const add = (form: string, kinds: InflectionKind[]) => {
      if (!form || form === base || form.length > 100 || /[\u0000-\u001f]/.test(form)) return;
      for (const kind of kinds) {
        const link = { form, base, partOfSpeech: pos, kind, source: 'merriam-webster-collegiate', sourceRef: entry.meta!.id! };
        result.set(JSON.stringify([base, pos, form, kind]), link);
      }
    };
    for (const item of entry.ins ?? []) {
      if (!item.if) continue; // A cutback alone is not a complete spelling.
      const form = spelling(item.if);
      const label = item.il?.toLowerCase();
      const kinds = (label ? labels[label] : undefined) ?? regular.get(form)
        ?? (pos === 'noun' ? ['plural'] : pos === 'verb' ? ['verb_form'] : []);
      add(form, kinds);
    }
    for (const stem of entry.meta.stems ?? []) {
      const form = spelling(stem), kinds = regular.get(form);
      // A regular-looking past stem may belong to a run-on, even for irregular verbs (mean -> meaned).
      if (kinds && !kinds.includes('past')) add(form, kinds);
    }
  }
  return [...result.values()];
}
