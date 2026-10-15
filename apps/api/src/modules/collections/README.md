# Vocabulary persistence

`dictionary_entries` identifies an exact-case spelling and part of speech. Ordered meanings live in
`dictionary_definitions`, keyed by entry, language code and sense order. The product reads English only;
users cannot edit definitions. Source metadata and word-family links stay on entries.

Official collections use `collection_entries` for many-to-many membership. Saving a collection adds its
entries to the account's single personal vocabulary without duplicates. `user_words` holds review progress
and explicit exclusions; unsaving a collection keeps those rows. Maintenance renews saved memberships
without overwriting exclusions or progress.

`library_state` contains one cache token. Dictionary maintenance reports differences before applying them;
referenced removals require further action. See [maintenance](../../../../../scripts/DATABASE-REDEPLOY.md).
