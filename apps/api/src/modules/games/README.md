# Puzzle answers and rules

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
