// Only reviewed non-personal proper-noun senses are admitted to games.
export const playableProperNounSql = `(e.part_of_speech='proper noun' AND e.source_metadata @> '{"gameEligible":true}'::jsonb)`;
export const playableEntrySql = `(e.part_of_speech NOT IN ('proper noun','proper_noun','name') OR ${playableProperNounSql})`;

export const playableEntryWhere = { OR: [
  { partOfSpeech: { notIn: ['proper noun','proper_noun','name'] } },
  { partOfSpeech: 'proper noun', sourceMetadata: { path: ['gameEligible'], equals: true } },
] };

export function gameWord(entry: { term: string; partOfSpeech: string; sourceMetadata: unknown }) {
  const metadata = entry.sourceMetadata;
  const reviewed = entry.partOfSpeech === 'proper noun' && metadata !== null && typeof metadata === 'object'
    && 'gameEligible' in metadata && metadata.gameEligible === true;
  if (reviewed) return /^[A-Za-z]+$/.test(entry.term) ? entry.term.toLowerCase() : undefined;
  return !['proper noun','proper_noun','name'].includes(entry.partOfSpeech) && /^[a-z]+$/.test(entry.term) ? entry.term : undefined;
}
