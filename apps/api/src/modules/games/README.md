# Puzzle answers and rules

Word Ladder gives a common four- or five-letter starting word. Make four new,
distinct dictionary words, replacing exactly one letter from the previous word
each time. The starting word cannot be reused. Every start has a verified chain
of four new common words, and players may also use the broader dictionary.
The neutral grid includes definitions and pronunciation with the same invalid-word
handling as Word Guess. Entry costs 1 coin; completing the chain awards 4 coins
for four-letter words or 5 coins for five-letter words. Paths survive reloads.

`POST /games/:id/give-up` ends either puzzle as a loss and keeps the entry coin
spent. Word Guess reveals its answer. Repeating the request does not change the
balance. Unfinished ladders from the old goal-based rules are refunded on migration.

Players can replace and refund a game only before its first accepted word.
Invalid words do not count. After an accepted word, both abandonment and a new
start return `PUZZLE_ALREADY_STARTED` until the player finishes or gives up.

`GET /games/wallet` includes `activeGameId` so the client can recover an unfinished
game from its session cookie even when local storage is missing (such as a changed local dev port).

Default five-letter answers use the original Wordle list. At 3–4 and 6–9 letters,
defaults use the existing Oxford A1–B2 vocabulary selection. Both pools intersect
the live dictionary, so every answer is lowercase, alphabetic, and has an English
definition. Empty pools fail explicitly; they never fall back to obscure entries.

Choosing an official collection or My Word List uses that vocabulary instead.
Guesses can use the broader dictionary at the selected length. The setup count
for the default selection uses the same filtering as game creation.

Rules reference: [Hello wordl](https://github.com/lynn/hello) uses a curated target
list separately from accepted guesses. Its [examples](https://github.com/lynn/hello/blob/main/src/About.tsx)
illustrate positional feedback and repeated letters at four letters. LexiPlay
applies the same duplicate-aware scoring at every length, with six guesses in
normal mode. Its easy/hard modes intentionally offer seven/five guesses; invalid
words cost no guess, and complete words submit automatically.

`GET /progress/summary?timezone=America/Toronto&page=2&pageSize=10` returns lifetime
metrics with a page of recent practice and `page`, `pageSize`, `totalPages` metadata.
Pages are clamped to available history; page sizes are 1–50. Dictionary definitions
are resolved only for the displayed page. The frontend caches history briefly and
invalidates it when a puzzle finishes. Recent-word additions use the shared pending
word selection flow, including duplicate protection and saving when leaving the page.
