# Word List — Product and API design

**Status:** Current implementation · **Updated:** 2026-10-09

## Product behavior

Each account has one overall personal list named **My words**. The list has no description or folders. Its words are searchable, can be added manually or from the shared dictionary, and can be imported from a file. A word has one of two learner-managed statuses: **Known** and **Unfamiliar**. New words start as **Unfamiliar**.

The Word List page combines the user's saved words with dictionary search results. Dictionary matches show the headword, definition, and available part of speech. Adding a result stores a personal copy with its dictionary definition; removing or changing the personal copy does not modify the shared dictionary. Word status is visible next to each saved word and can be toggled between Known and Unfamiliar.

## Import flow

Supported formats are `.txt`, `.docx`, `.csv`, `.xlsx`, and text-based `.pdf`. The user selects a file, previews parsed words, then confirms the import. The preview reports duplicates and invalid rows. Imported words receive the Unfamiliar status by default. Definitions and examples are stored as plain text; uploaded files are not retained.

Limits are enforced by the API: 5 MB maximum upload, 1,000 preview rows, and PDF extraction from the first 50 pages. Image-only/scanned PDFs need OCR and currently produce no extracted words. Macro-enabled workbooks and legacy `.doc` files are not accepted.

## API

Dictionary search and definition lookup are public. Personal list endpoints require the signed-in session cookie.

| Method and path | Purpose |
|---|---|
| `GET /api/v1/word-lists` | Ensure and return the caller's single overall list. |
| `GET /api/v1/word-lists/:listId` | Return the caller's list and its words. |
| `GET /api/v1/word-lists/dictionary?q=...` | Search the shared Simple English Wiktionary dictionary by exact term or prefix. |
| `POST /api/v1/word-lists/:listId/dictionary` | Add a dictionary term to the caller's list as Unfamiliar. |
| `POST /api/v1/word-lists/:listId/words` | Add a manual word as Unfamiliar. |
| `PATCH /api/v1/word-lists/:listId/words/:wordId` | Edit a personal word or set `status` to `KNOWN` or `UNFAMILIAR`. |
| `DELETE /api/v1/word-lists/:listId/words/:wordId` | Remove a personal word. |
| `POST /api/v1/word-lists/:listId/import-preview` | Parse a supported file and return a preview without writing words. |
| `POST /api/v1/word-lists/:listId/import` | Save selected preview rows as Unfamiliar. |

The API accepts terms containing letters, spaces, apostrophes, and hyphens, up to 100 characters. Terms are normalized to lowercase. A unique constraint prevents duplicate terms in one user's list. The overall list is created lazily on first `GET /word-lists`; a database migration merges any previous lists for each owner, keeps duplicate terms once, removes the description field, and enforces one list per owner.

## Shared dictionary

The PostgreSQL `dictionary_words` table is LexiPlay’s canonical dictionary. Search, definitions, game answers, and accepted guesses use these stored entries. Simple English Wiktionary supplies the initial data. The seed command reads namespace-zero entry revisions from the MediaWiki API, extracts the first two definition lines and their parts of speech, excludes redirects, and filters entries to terms supported by LexiPlay. Page introductions are not used because many dictionary entries, including “because,” have no introduction:

```powershell
pnpm --filter @lexiplay/api dictionary:seed
```

Run this after starting the local database with `docker compose up -d database`; the API seeder needs internet access. A refresh stages the complete import and only replaces the existing dictionary after all pages load successfully. Attribution and source terms are documented in [`SIMPLE-WIKTIONARY-LICENSE`](../../apps/api/src/modules/word-lists/SIMPLE-WIKTIONARY-LICENSE).

Games select from dictionary entries of the chosen length (3–8), containing only `a`–`z` and a nonempty definition. The same pool validates guesses. “Play with my words” intersects the personal list with this pool for answer selection; other dictionary words remain valid guesses. Personal notes and manual entries do not change the canonical dictionary. Each game retains its starting pool so a dictionary refresh does not change its valid guesses. An empty dictionary pool produces `DICTIONARY_NOT_READY`; there is no static-file fallback. Public dictionary search and ordinary guest games do not require account tables or a login.

## Verification seams

- HTTP tests cover owner-scoped list retrieval, dictionary search/add, default unfamiliar status, status updates, and import preview/confirm.
- UI tests cover list search, dictionary add, status changes, and file preview/confirmation.
- Parser and upload limits are enforced in the API module.
