export function importTerms(text: string, format: 'txt' | 'csv' | 'tsv' = 'txt') {
  return [...new Set(text.split(/\r?\n/).map((line, index) => {
    const value = format === 'csv' ? (line.match(/^\s*"((?:[^"]|"")*)"(?:,|$)/)?.[1]?.replace(/""/g, '"') ?? line.split(',')[0]!) : format === 'tsv' ? line.split('\t')[0]! : line;
    const term = value.trim().toLowerCase();
    return format !== 'txt' && index === 0 && ['word', 'term'].includes(term) ? '' : term;
  }).filter(Boolean))];
}
