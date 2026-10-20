# Puzzle answers and rules

Word Ladder offers four- or five-letter words from the common default answer
pools described below, with dictionary definitions and no step limit. Each move substitutes
exactly one letter and must appear in the game dictionary. Start and goal words
have a verified shortest path of 3–6 moves in the common pool; players may use
the broader dictionary and take longer routes. Entry costs 1 coin and reaching
the goal awards 5 coins. Ladder paths survive reloads and completion.
Rules: [Word ladder](https://en.wikipedia.org/wiki/Word_ladder).

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
