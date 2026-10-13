# Vocabulary practice ranges

`vocabulary-ranges.ts` owns the range IDs, labels and original curated word sets. The API is the source of the browser's range menu and live answer counts.

- **Primary school** combines familiar everyday words with school subjects.
- **Grade 12** combines senior-school literature, essay, science and abstract vocabulary.
- **IELTS practice** focuses on academic study, society, work and environment topics.
- **CEFR A1–A2**, **B1–B2**, and **C1–C2** offer basic, independent and advanced practice sets.
- **All vocabulary** keeps the existing unrestricted answer pool.

These are illustrative practice lists, not exhaustive syllabuses, official IELTS lists, or certified CEFR assignments for individual words. Word senses, learners' backgrounds and curricula affect difficulty. The interface states that the levels are approximate. The [Council of Europe's CEFR level descriptions](https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions) inform the three practice bands; [IELTS Academic](https://ielts.org/organisations/ielts-for-organisations/test-types/ielts-academic-test) informs the academic focus. The lists themselves are original editorial selections rather than copied reference datasets.

Only lowercase alphabetic dictionary entries with definitions and the chosen 3–9-letter length can become answers. Longer words in the curated source cannot appear in current puzzles. Personal-word mode adds a further intersection with the user's saved words. Empty intersections produce an explicit error; the server never broadens a selected range automatically.

Guesses continue to use the complete dictionary snapshot for the chosen length. This avoids rejecting a valid guess simply because it is outside the answer range. The range ID is stored in the existing game JSON state, so no database migration is needed. Legacy games default to `all`.
