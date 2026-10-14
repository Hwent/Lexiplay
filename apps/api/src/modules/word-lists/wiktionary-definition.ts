const partsOfSpeech = new Set([
  'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'conjunction', 'subordinator', 'coordinator', 'determiner', 'article', 'interjection', 'numeral',
  'suffix', 'prefix', 'affix', 'contraction', 'number', 'particle', 'auxiliary verb', 'expression', 'phrase', 'letter', 'symbol',
]);

function plainText(value: string): string {
  let text = value.replace(/<!--.*?-->/g, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  // Expand common word-form definitions; formatting, labels and synonym templates are omitted.
  for (let pass = 0; pass < 5 && text.includes('{{'); pass++) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_match, body: string) => {
      const [name = '', ...args] = body.split('|').map(item => item.trim());
      const template = name.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
      const aliases: Record<string, string> = { pp: 'present participle of', tps: 'third person singular of', 'third person': 'third person singular of', 'present participle': 'present participle of' };
      const normalized = aliases[template] ?? template;
      if (/^(plural|singular|simple past|gerund participle|past|past tense|past participle|past tense and participle|past tense and past participle|present participle|present tense|third person singular|third person singular present|comparative|superlative|alternative spelling|alternative form|abbreviation|short form) of$/.test(normalized)) {
        const term = args.find(item => item && item !== 'en' && !item.includes('='));
        return term ? `${normalized[0]!.toUpperCase()}${normalized.slice(1)} ${term}.` : '';
      }
      if (['another word', 'another name', 'clipping of', 'feminine form of', 'tone indicator'].includes(normalized)) {
        const term = args.find(item => item && item !== 'en' && !item.includes('='));
        const label: Record<string, string> = { 'another word': 'Another word for', 'another name': 'Another name for', 'clipping of': 'Short form of', 'feminine form of': 'Feminine form of', 'tone indicator': 'Tone indicator meaning' };
        return term ? label[normalized] + ' ' + term + '.' : '';
      }
      if (normalized === 'lc') return args[0] ?? '';
      if (['l', 'link', 'm', 'mention'].includes(normalized)) return args[args[0] === 'en' ? 1 : 0] ?? '';
      return '';
    });
  }
  return text
    .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '')
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label: string | undefined) => label ?? target.replace(/^w:/, ''))
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/'{2,5}/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => { const point = Number(code); return point <= 0x10ffff ? String.fromCodePoint(point) : ''; })
    .replace(/\s+/g, ' ').trim();
}

export function parseWiktionaryDefinition(content: string) {
  const groups = new Map<string, string[]>();
  let position: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^(={2,})\s*(.*?)\s*\1\s*$/);
    if (heading) {
      // Homographs use numbered sections (for example, tear: Noun 1 / Noun 2).
      const label = heading[2]!.trim().toLowerCase().replace(/\s+\d+$/, '');
      position = partsOfSpeech.has(label) ? label : undefined;
    }
    if (/^\s*\{\{\s*(?:abbreviation|initialism|acronym)(?:[ |}])/i.test(line)) position = undefined;
    const sense = line.match(/^#+(?![#:*])\s*(.+)$/)
      ?? line.match(/^\s*(\{\{(?:plural of|singular of|simple past of|gerund[- ]participle of|present participle(?: of)?|past participle of|past tense(?: and participle)? of|third[- ]person singular of|third person|tps|pp)\|.*\}\})\s*$/i);
    if (!position || !sense) continue;
    if (/\{\{\s*(?:abbreviation|initialism|acronym|(?:male |female )?given name|surname)(?:[ |}])/i.test(sense[1]!)) continue;
    const definition = plainText(sense[1]!);
    if (!definition || /\{\{|\[\[/.test(definition)) continue;
    const definitions = groups.get(position) ?? [];
    if (!definitions.includes(definition)) definitions.push(definition);
    groups.set(position, definitions);
  }
  const senses = [...groups].map(([partOfSpeech, definitions]) => ({ partOfSpeech, definitions }));
  const definition = senses.map(sense => (senses.length > 1 ? sense.partOfSpeech + ': ' : '') + sense.definitions.join('; ')).join('\n');
  return { definition, partOfSpeech: [...groups.keys()], senses };
}
