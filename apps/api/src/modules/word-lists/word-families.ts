import data from './family-data/bnc-coca.json';

export type FamilyIdentity = { id: string; headword: string; kind: 'family' | 'phrase' | 'unclassified' };
const mapping = new Map(Object.entries(data.members).map(([term, value]) => [term, { headword: String(value[0]), band: Number(value[1]) }]));
export function wordFamily(term: string): FamilyIdentity {
  const normalized = term.normalize('NFC').trim().toLowerCase();
  const family = mapping.get(normalized);
  if (family) return { id: `bnc-coca-v1:${family.band}:${family.headword}`, headword: family.headword, kind: 'family' };
  return { id: `item:${normalized}`, headword: normalized, kind: /\s/.test(normalized) ? 'phrase' : 'unclassified' };
}
export function familyCounts(terms: string[]) {
  const units = new Set<string>();
  let familyCount = 0;
  for (const term of terms) {
    const family = wordFamily(term);
    if (units.has(family.id)) continue;
    units.add(family.id);
    if (family.kind === 'family') familyCount++;
  }
  return { familyCount, otherUnitCount: units.size - familyCount };
}
export function groupFamilies<T>(rows: T[], term: (row: T) => string) {
  const groups = new Map<string, FamilyIdentity & { members: T[] }>();
  for (const row of rows) {
    const identity = wordFamily(term(row));
    const family = groups.get(identity.id) ?? { ...identity, members: [] };
    family.members.push(row); groups.set(family.id, family);
  }
  return [...groups.values()];
}
