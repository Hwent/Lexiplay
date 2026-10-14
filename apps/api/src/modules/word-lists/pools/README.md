# Oxford CEFR gaming pools

These five lists are generated from the supplied `test_materials/en-LEVEL.json` files and credited to `oxford_3000_5000`.

| Level | Words |
| --- | ---: |
| A1 | 898 |
| A2 | 793 |
| B1 | 691 |
| B2 | 1,297 |
| C1 | 1,278 |

Each JSON file stores identity, author, level, terms and normalized source parts of speech. Source definitions and pronunciation fields are not copied. The separate [C2 selection](C2-SELECTION.md) uses Octanove and the curated starter; it is not attributed to Oxford.

Run `pnpm cefr:build` from the repository root to regenerate the assets. The API initializes the five records in `game_word_pools`; signed-in additions are references in `user_game_pools`, while guest additions are stored on the device.

The Word List page offers Add list and a paginated dictionary preview. Adding or opening a list resolves current dictionary senses for the source part of speech. Missing senses are shown explicitly. Adding a list does not copy its words into the personal My words list.

Added lists appear in the CEFR gaming pool selector. Games use dictionary-backed alphabetic words at the chosen 3–9-letter length. An empty pool at the requested length produces an error rather than silently switching to the full dictionary. Guesses still use the complete dictionary at that length.
