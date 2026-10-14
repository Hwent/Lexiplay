import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFamilyFile } from './audit-cefr-families.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.argv[2] ?? resolve(root, '.local-backups/word-families/bnc-coca'));
const families = [], hash = createHash('sha256');
for (let band = 1; band <= 25; band++) {
  const file = `basewrd${band}.txt`, bytes = await readFile(resolve(directory, file));
  hash.update(file + '\0'); hash.update(bytes);
  const rows = parseFamilyFile(bytes.toString('utf8'), band);
  if (rows.length !== 1000) throw new Error('Incomplete published family source.');
  families.push(...rows);
}
const folder = resolve(root, 'apps/api/src/modules/word-lists/pools');
const pools = await Promise.all((await readdir(folder)).filter(name => name.endsWith('.json'))
  .map(async name => JSON.parse(await readFile(resolve(folder, name), 'utf8'))));
const wanted = new Set(pools.flatMap(pool => pool.words.map(word => word.term)));
const members = {};
for (const family of families) for (const member of family.members) if (wanted.has(member)) {
  if (Object.hasOwn(members, member)) throw new Error('Ambiguous published family member: ' + member);
  members[member] = [family.headword, family.band];
}
const target = resolve(root, 'apps/api/src/modules/word-lists/family-data');
await mkdir(target, { recursive: true });
await writeFile(resolve(target, 'bnc-coca.json'), JSON.stringify({
  source: 'Paul Nation BNC/COCA v1.0.0',
  url: 'https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/vocabulary-analysis-programs/range/BNC_COCA_25000.zip',
  contentSha256: hash.digest('hex'),
  licenseBasis: 'University resource terms: CC BY-SA 4.0 or GPL v2/3 as appropriate; word-list adaptation retained under CC BY-SA 4.0.',
  members: Object.fromEntries(Object.entries(members).sort(([a], [b]) => a.localeCompare(b))),
}, null, 2) + '\n');
console.log(JSON.stringify({ mappedTerms: Object.keys(members).length, sourceFamilies: families.length }));
const publicData=resolve(root,'apps/web/public/data');
await mkdir(publicData,{recursive:true});
await copyFile(resolve(target,'bnc-coca.json'),resolve(publicData,'bnc-coca-families.json'));
await copyFile(resolve(folder,'lexiplay-c2.json'),resolve(publicData,'lexiplay-c2.json'));
