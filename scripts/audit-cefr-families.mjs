import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const normalize = term => term.normalize('NFC').trim().toLowerCase();

// RANGE files use indentation, not spelling similarity, to express family membership.
export function parseFamilyFile(text, band) {
  const families = [];
  let family;
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = /^(\s*)(\S+)\s+0\s*$/.exec(line);
    if (!match) throw new Error(`Invalid family-list row in band ${band}.`);
    const term = normalize(match[2]);
    if (!match[1]) {
      family = { id: `bnc-coca-v1:${band}:${term}`, headword: term, band, members: [term] };
      families.push(family);
    } else {
      if (!family) throw new Error(`Family member has no headword in band ${band}.`);
      if (!family.members.includes(term)) family.members.push(term);
    }
  }
  return families;
}

export function auditPools(pools, families) {
  const index = new Map();
  for (const family of families) for (const member of family.members) {
    const matches = index.get(member) ?? new Map();
    matches.set(family.id, family); index.set(member, matches);
  }
  const levelsByFamily = new Map();
  const collections = pools.map(pool => {
    const matched = new Map(), unresolved = [], ambiguous = [], phrases = [];
    for (const word of pool.words) {
      const term = normalize(word.term);
      if (/\s/.test(term)) { phrases.push(word); continue; }
      const matches = [...(index.get(term)?.values() ?? [])];
      if (!matches.length) { unresolved.push(word); continue; }
      if (matches.length > 1) { ambiguous.push({ ...word, candidates: matches.map(f => ({ id: f.id, headword: f.headword })) }); continue; }
      const family = matches[0];
      const group = matched.get(family.id) ?? { id: family.id, headword: family.headword, frequencyBand: family.band, members: [] };
      group.members.push(word); matched.set(family.id, group);
      const levels = levelsByFamily.get(family.id) ?? new Map();
      const members = levels.get(pool.level) ?? [];
      members.push(word); levels.set(pool.level, members); levelsByFamily.set(family.id, levels);
    }
    return { id: pool.id, level: pool.level, lemmaCount: pool.words.length,
      entryCount: pool.words.reduce((count, word) => count + word.partsOfSpeech.length, 0),
      mappedLemmaCount: [...matched.values()].reduce((count, f) => count + f.members.length, 0),
      mappedFamilyCount: matched.size, unclassifiedLemmaCount: unresolved.length,
      ambiguousLemmaCount: ambiguous.length, phraseCount: phrases.length,
      complete: unresolved.length === 0 && ambiguous.length === 0 && phrases.length === 0,
      families: [...matched.values()], unresolved, ambiguous, phrases };
  });
  return { collections, distinctMappedFamilies: levelsByFamily.size,
    crossLevelFamilies: [...levelsByFamily].filter(([, levels]) => levels.size > 1)
      .map(([familyId, levels]) => ({ familyId, levels: Object.fromEntries(levels) })) };
}

async function main() {
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const directory = resolve(option('--directory') ?? resolve(project, '.local-backups/word-families/bnc-coca'));
  const contentHash = createHash('sha256');
  const families = [];
  // 26–34 are filler/special lists, including names, compounds and acronyms.
  for (let band = 1; band <= 25; band++) {
    const name = `basewrd${band}.txt`, bytes = await readFile(resolve(directory, name));
    contentHash.update(name + '\0'); contentHash.update(bytes);
    const parsed = parseFamilyFile(bytes.toString('utf8'), band);
    if (parsed.length !== 1000) throw new Error(`Expected 1,000 families in band ${band}; got ${parsed.length}.`);
    families.push(...parsed);
  }
  const folder = resolve(project, 'apps/api/src/modules/word-lists/pools');
  const pools = await Promise.all((await readdir(folder)).filter(name => name.endsWith('.json')).sort()
    .map(async name => JSON.parse(await readFile(resolve(folder, name), 'utf8'))));
  const report = { source: 'Paul Nation BNC/COCA word-family lists v1.0.0',
    sourceUrl: 'https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/vocabulary-analysis-programs/range/BNC_COCA_25000.zip',
    sourceFamilyCount: families.length, contentSha256: contentHash.digest('hex'),
    status: 'audit-only; no collection memberships, CEFR levels or learner data changed',
    ...auditPools(pools, families) };
  if (option('--report')) {
    const target = resolve(option('--report'));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ sourceFamilyCount: report.sourceFamilyCount,
    distinctMappedFamilies: report.distinctMappedFamilies, crossLevelFamilyCount: report.crossLevelFamilies.length,
    collections: report.collections.map(({ families, unresolved, ambiguous, phrases, ...summary }) => summary) }, null, 2));
  if (process.argv.includes('--require-complete') && report.collections.some(collection => !collection.complete)) {
    console.error('Family audit incomplete: resolve unclassified/ambiguous lemmas and handle phrases separately before publishing family counts.');
    process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
