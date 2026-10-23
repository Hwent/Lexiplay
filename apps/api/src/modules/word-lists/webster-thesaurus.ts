export const THESAURUS_SOURCE = 'merriam-webster-thesaurus';
const lists = { syn_list: 'synonym', phrase_list: 'synonym', ant_list: 'antonym', sim_list: 'similar',
  rel_list: 'related', near_list: 'near_antonym', opp_list: 'opposite' } as const;
export type ThesaurusRelation = {
  term: string; kind: typeof lists[keyof typeof lists]; sourceList: string;
  groupOrder: number; sortOrder: number; metadata: Record<string, unknown>;
};
export type ThesaurusSense = {
  source: string; sourceEntryId: string; senseKey: string; term: string; partOfSpeech: string;
  definition: string; metadata: Record<string, unknown>; relations: ThesaurusRelation[];
};
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value);
function text(value: string) {
  return value.replace(/\{([^{}]*)\}/g, (_token, body: string) => {
    const [name, display] = body.split('|');
    return name === 'bc' ? ': ' : name === 'amp' ? '&' : display ?? '';
  }).replace(/\s+/g, ' ').trim();
}

export function websterThesaurus(response: unknown, requestedTerm: string): ThesaurusSense[] {
  if (!Array.isArray(response)) throw new Error('Thesaurus API did not return a JSON array.');
  const result: ThesaurusSense[] = [];
  for (const entry of response) {
    if (!object(entry)) continue; // String arrays contain spelling suggestions.
    const meta = entry.meta, hwi = entry.hwi;
    if (!object(meta) || !object(hwi) || typeof meta.id !== 'string' || typeof hwi.hw !== 'string' || typeof entry.fl !== 'string') continue;
    const term = hwi.hw.replace(/\*/g, '').normalize('NFC').trim();
    if (term !== requestedTerm) continue;
    const pos = ['transitive verb', 'intransitive verb'].includes(entry.fl) ? 'verb' : entry.fl;
    const parseSense = (sense: ObjectValue, path: string) => {
      const relations = new Map<string, ThesaurusRelation>();
      for (const [field, kind] of Object.entries(lists)) {
        const groups = sense[field];
        if (!Array.isArray(groups)) continue;
        groups.forEach((group, groupOrder) => {
          if (!Array.isArray(group)) return;
          group.forEach((word, sortOrder) => {
            if (!object(word) || typeof word.wd !== 'string') return;
            const target = text(word.wd).normalize('NFC');
            if (!target || target === term || /[\u0000-\u001f\u007f]/.test(target)) return;
            const { wd, ...metadata } = word;
            const key = JSON.stringify([kind, target]);
            if (!relations.has(key)) relations.set(key, { term: target, kind, sourceList: field, groupOrder, sortOrder, metadata });
          });
        });
      }
      if (!relations.size) return;
      const definingText = Array.isArray(sense.dt) ? sense.dt.filter(item => Array.isArray(item) && item[0] === 'text' && typeof item[1] === 'string')
        .map(item => text(item[1])).join(' ') : '';
      const { dt, syn_list, ant_list, sim_list, rel_list, near_list, opp_list, phrase_list, sdsense, ...labels } = sense;
      result.push({ source: THESAURUS_SOURCE, sourceEntryId: typeof meta.uuid === 'string' ? meta.uuid : `${meta.id}:${pos}`, senseKey: path, term, partOfSpeech: pos,
        definition: definingText, metadata: { ...labels, headwordRef: meta.id, sourceUuid: meta.uuid ?? null, offensive: meta.offensive ?? false,
          entryLabels: { sls: entry.sls ?? [], lbs: entry.lbs ?? [] } }, relations: [...relations.values()] });
    };
    const visit = (value: unknown, path: string): void => {
      if (Array.isArray(value)) {
        if (['sense', 'sen'].includes(value[0]) && object(value[1])) {
          parseSense(value[1], path);
          if (object(value[1].sdsense)) { parseSense(value[1].sdsense, path + '.sdsense'); }
          visit(value[1].sdsense, path + '.sdsense.children');
        } else value.forEach((child, index) => visit(child, `${path}.${index}`));
      } else if (object(value)) {
        // Binding substitutes wrap a sense rather than using the ordinary tagged pair.
        for (const [key, child] of Object.entries(value)) {
          if (key === 'sense' && object(child)) parseSense(child, path + '.sense');
          else visit(child, path + '.' + key);
        }
      }
    };
    visit(entry.def, 'def');
  }
  return result;
}
