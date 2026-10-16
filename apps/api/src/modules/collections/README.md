# Vocabulary persistence

`dictionary_entries` identifies an exact-case spelling and part of speech. Ordered meanings live in
`dictionary_definitions`, keyed by entry, language code and sense order. The product reads English only;
users cannot edit definitions. Source metadata and word-family links stay on entries.

Official collections use `collection_entries` for many-to-many membership. Saving a collection adds its
entries to the account's single personal vocabulary without duplicates. `user_words` holds review progress
and explicit exclusions; unsaving a collection keeps those rows. Maintenance renews saved memberships
without overwriting exclusions or progress.

Hidden collections support dedicated games and are excluded from catalog, detail, import, and normal
game-picker routes. `POST /games` with `{ "kind": "wordle" }` selects `wordle-original` at five letters.
The original 2,315-answer list is pinned in `word-lists/pools/wordle-answers.json` from
[cfreshman's source extraction](https://gist.github.com/cfreshman/a03ef2cba789d8cf00c08f767e0fad7b),
revision `c46f451920d5cf6326d550fb2d6abb1642717852`. Migration and dictionary publication populate
membership from matching dictionary entries with English definitions, excluding names. Guesses still
use the full practice dictionary. This pool is independent of subsequent NYT editorial changes.

`library_state` contains one cache token. Dictionary maintenance reports differences before applying them;
referenced removals require further action. See [maintenance](../../../../../scripts/DATABASE-REDEPLOY.md).
