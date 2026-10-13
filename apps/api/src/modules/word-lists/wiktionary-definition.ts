const partsOfSpeech = new Set([
  'noun', 'proper noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
  'conjunction', 'coordinator', 'determiner', 'article', 'interjection', 'numeral',
  'number', 'particle', 'auxiliary verb', 'expression', 'phrase', 'letter', 'symbol',
]);

function plainText(value: string): string {
  let text = value.replace(/<!--.*?-->/g, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  // Expand common word-form definitions; formatting, labels and synonym templates are omitted.
  for (let pass = 0; pass < 5 && text.includes('{{'); pass++) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_match, body: string) => {
      const [name = '', ...args] = body.split('|').map(item => item.trim());
      const normalized = name.toLowerCase().replace(/-/g, ' ');
      if (/^(plural|past|past tense|past participle|present participle|comparative|superlative|alternative spelling|alternative form|abbreviation|short form) of$/.test(normalized)) {
        const term = args.find(item => item && item !== 'en' && !item.includes('='));
        return term ? `${normalized[0]!.toUpperCase()}${normalized.slice(1)} ${term}.` : '';
      }
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
  const senses: string[] = [];
  const positions = new Set<string>();
  let position: string | undefined;
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^(={2,})\s*(.*?)\s*\1\s*$/);
    if (heading && heading[1]!.length <= 2) {
      // Homographs use numbered sections (for example, tear: Noun 1 / Noun 2).
      const label = heading[2]!.trim().toLowerCase().replace(/\s+\d+$/, '');
      position = partsOfSpeech.has(label) ? label : undefined;
    }
    const sense = line.match(/^#{1,2}(?![#:*])\s*(.+)$/);
    if (!position || !sense) continue;
    const definition = plainText(sense[1]!);
    if (!definition || /\{\{|\[\[/.test(definition)) continue;
    positions.add(position);
    if (senses.length < 2 && !senses.includes(definition)) senses.push(definition);
  }
  return { definition: senses.join('; ').slice(0, 2000), partOfSpeech: [...positions] };
}
