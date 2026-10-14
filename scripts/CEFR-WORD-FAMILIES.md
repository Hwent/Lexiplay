# Building family-based CEFR collections

The CEFR library now groups mapped lemma/POS entries into family cards. It shows family and member counts separately; unmapped entries and phrases remain independent study items. Family grouping preserves each member's level, dictionary meaning and learning history; it does not replace every member with a root or award mastery of derivatives automatically.

## Repeatable local audit

Download the [official Nation archive](https://www.wgtn.ac.nz/lals/resources/paul-nations-resources/vocabulary-analysis-programs/range/BNC_COCA_25000.zip) and extract its plain files to `.local-backups/word-families/bnc-coca`. Do not run or distribute the bundled executable. Use another folder with `--directory` if needed.

```powershell
pnpm cefr:audit-families --report docs/research/cefr-family-audit.json
pnpm cefr:audit-families --require-complete
```

The first command reports mapped families, unmatched/ambiguous lemmas, phrases and families spanning levels. The second exits with code 2 when unresolved items remain; it is a readiness check, not an importer. It leaves the database, collection membership and learner data untouched. Frequency bands are never converted to CEFR levels. Files 1–25 contain the general families; special lists are excluded. A UTF-8 BOM is removed before parsing indentation. Source-content hashes are retained in the report.

## Recommended construction method

1. Preserve graded lemma/POS entries and their original evidence. Add versioned family identities from a published mapping, with provenance.
2. Resolve unknown terms, spelling variants, compounds, abbreviations and multiword expressions explicitly. Do not force these into a family by stemming or remove them from valid collections.
3. Keep CEFR evidence on individual members and, eventually, on individual senses. A family can recur across levels as learners meet additional forms or meanings.
4. Present family cards containing level-appropriate members. Show distinct family count, member count and unresolved count separately. Paginate family identities, but preserve individual dictionary-entry IDs for saving and learning progress.
5. Verify every displayed member has a definition for its intended word class. Keep phrases/idioms as their own learning units. For C2, include advanced senses and idiomatic usage; do not equate rarity or a vocabulary-size threshold with proficiency.

The family view is requested with `view=families`. Whole families are paginated together. The API caches definition-free official membership references after the seed transaction commits, precomputes cross-level relations, and resolves definitions and private saved status only for the visible page. Existing flat endpoints remain available. Member IDs are unchanged, so selections, duplicate skipping and learning progress remain independent of grouping.

The browser now downloads the complete public `/collections/:slug/snapshot` once and saves it in IndexedDB. Snapshot keys are collection slugs, with source version validation and a 24-hour lifetime; a local-storage fallback is available when IndexedDB is absent. Family pagination then runs locally. `Refresh local copy` explicitly updates dictionary content. Saved-word IDs are fetched independently into account-scoped memory and are never persisted in the public snapshot. Storage failure leaves the collection usable for the visit without claiming that it was saved. Native checkbox semantics are retained beneath SVG selection controls. The current collection's level is displayed once, and every available CEFR collection can be selected as a gaming pool without a saved subscription.

The expanded C2 selection contains 942 headwords, 978 member/POS entries and 731 mapped families. There are 4,288 distinct mapped families across all levels and 706 families spanning levels. The 107 unclassified lemmas/phrases from A1–C1 remain explicit study items; they are not relabelled as families. Membership verification does not establish official CEFR grading.

`pnpm cefr:build-families` generates the compact API mapping and public data exports from the published plain-text source. The library does not send the full mapping or full dictionary to the browser. See `apps/web/public/licenses/cefr-data-NOTICE.md` for source attribution, licence basis and adaptations.

## Sources and tools

- [MyVocab methodology](https://www.myvocab.info/en/howitworks): broad receptive word families include derived forms. Its vocabulary-size estimates and C2 threshold are not a prescribed collection inventory.
- [Nation's resources](https://www.wgtn.ac.nz/lals/resources/paul-nations-resources): published BNC/COCA family map and corpus profiling tools. The university states CC BY-SA 4.0 or GPL v2/3 as appropriate to the resource; the ZIP contains no archive-specific licence notice. Preserve that evidence and attribution, distinguish data from executable software, and establish the applicable data terms before publishing a derived dataset.
- [British Council WFF](https://www.teachingenglish.org.uk/professional-development/teachers/planning-lessons-and-courses/articles/word-family-framework): a reference for family members at different A1–C2 levels. Public access is not an assumed bulk-reuse licence.
- [English Vocabulary Profile research](https://www.cambridge.org/core/journals/english-profile-journal/article/completing-the-english-vocabulary-profile-c1-and-c2-vocabulary/418955FC7ED2455E98A499BC40C2C816): sense-level grading, phrases and family panels; useful for validating level evidence. [Access terms](https://englishprofile.org/?menu=english-vocabulary-profile) restrict commercial reuse.
- [EFLLex](https://cental.uclouvain.be/cefrlex/efllex/): A1–C1 receptive lemma/POS frequencies; [download](https://cental.uclouvain.be/cefrlex/efllex/download/) is CC BY-NC-SA 4.0. It does not provide C2 grading.
- [LemmInflect](https://github.com/bjascob/LemmInflect): MIT lemma/inflection normalization; does not establish full derivational families or CEFR.
- [AntWordProfiler](https://laurenceanthony.net/software/antwordprofiler/): editorial corpus-coverage checks against selected vocabulary lists; a profiling tool, not a CEFR classifier.

Research checked 2026-10-14; detailed local notes are in `docs/research/cefr-word-families.md`.
