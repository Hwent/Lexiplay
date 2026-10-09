# Vocabulary data sources

These files are newline-delimited lowercase ASCII words, separated by word length.

- `allowed-guesses-3.txt`, `allowed-guesses-4.txt`, and `allowed-guesses-6.txt` through `allowed-guesses-8.txt` are filtered from the English Speller Database (ESDB, formerly SCOWL v2). The source is [en-wl/wordlist](https://github.com/en-wl/wordlist), commit `1e5b7d3a72f47a71da5d28686c1dd4b397178485`. The exported data selects lowercase alphabetic headwords with an ESDB size of 60 or smaller, then filters by length. The included `SCOWL-COPYRIGHT.txt` preserves the required copyright and permission notice.
- `answers-3.txt` through `answers-8.txt` use the same ESDB source and filter. Answers are kept separately because the five-letter allowed-guess list below excludes answers.
- `allowed-guesses-5.txt` is the supplied [cfreshman Wordle allowed-guesses Gist](https://gist.github.com/cfreshman/cdcdf777450c5b5301e439061d29694c), snapshot `d7c9e02d45afd26e12a71b4564189a949c29e8a9`. The Gist identifies the list as allowed guesses excluding answers. Its page does not state a license; review its redistribution status before a public release.

All words are checked into the repository so local play and tests do not need a network connection. To update a list, preserve its source snapshot and license notes, regenerate the files, and review the diff.
