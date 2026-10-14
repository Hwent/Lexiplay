import { parseWiktionaryDefinition } from './wiktionary-definition';

export type WikiPage = { title: string; revisions?: Array<{ slots?: { main?: { content?: string } } }> };

// Used only for entries that have no definition; defined phrases remain eligible.
export function excludeEmptyWiktionaryEntry(title: string, content: string) {
  return /\s/.test(title)
    || /\{\{\s*(?:other|alternate|alternative)[ _-]+spelling[ _-]+of(?:[ |}])/i.test(content)
    || /['’]/.test(title)
    || /^={2,}\s*contraction\s*={2,}\s*$/mi.test(content)
    || /\{\{\s*(?:contraction[ _-]+of|negative[ _-]+of|unsure[ _-]+of)(?:[ |}])/i.test(content);
}

export function wiktionaryEntry(title: string, content: string) {
  // The welcome page is in namespace zero but is not a dictionary entry.
  if (title === 'Main Page') return null;
  // Preserve source titles even when definition parsing needs more support.
  const parsed = parseWiktionaryDefinition(content);
  const excluded = /^={2,}\s*(?:proper noun|abbreviation|initialism|acronym)(?:\s+\d+)?\s*={2,}\s*$/mi.test(content)
    || /\{\{\s*(?:abbreviation|initialism|acronym|(?:male |female )?given name|surname)(?:[ |}])/i.test(content);
  if (!parsed.senses.length && (excluded || excludeEmptyWiktionaryEntry(title, content))) return null;
  return { term: title, ...parsed };
}

export class WiktionaryEntryCollector {
  private readonly pending = new Set<string>();
  private readonly received = new Set<string>();

  collect(pages: WikiPage[]) {
    const entries = [];
    for (const page of pages) {
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (content === undefined) {
        // MediaWiki may deliver this page's revision in a later rvcontinue batch.
        if (!this.received.has(page.title)) this.pending.add(page.title);
        continue;
      }
      this.pending.delete(page.title);
      if (this.received.has(page.title)) continue;
      this.received.add(page.title);
      const entry = wiktionaryEntry(page.title, content);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  assertComplete() {
    if (this.pending.size) throw new Error('Missing revision content for ' + [...this.pending].join(', '));
  }
}
