# LexiPlay

LexiPlay helps learners build English vocabulary through word games, dictionary lookup, and saved practice.

## App

- **Word Guess:** find a hidden 3–9-letter word in six guesses, with definition hints.
- **Word Ladder:** make four new words by changing one letter at a time; choose four or five letters.
- **Guess Animal:** think of a common animal and answer Yes, No or Not Sure. A free, browser-run guessing algorithm asks up to 15 questions and makes up to 3 guesses. English questions include keyword explanations in the interface language; results can be saved to your vocabulary. See [game data and rules](apps/web/src/animal-guess/README.md).
- **Vocabulary:** explore curated collections, look up definitions and pronunciation, and save words to personal lists.
- **Progress:** track completed games, wins, and practice streaks; transfer guest progress after signing in.
- **Community:** rank the top 20 accounts by coin balance, showing only each username’s first letter.
- **Settings:** English or Chinese interface, themes, text size, and sound.

Word Guess and Word Ladder cost 1 coin. Word Guess wins award 4 coins at 3–4 letters, 5 at 5–6, 6 at 7–8, and 7 at 9 letters. Word Ladder wins award 4 or 5 coins by word length. Guess Animal is free and does not change the coin balance. New accounts receive 100 coins.

## API

Base path: `/api/v1`. Requests and responses use JSON. Cookie sessions identify accounts and guests; personal lists and statistics require sign-in.

| Function | Main endpoints |
| --- | --- |
| Accounts | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Games | `POST /games`, `GET /games/:id`, `POST /games/:id/guesses` |
| Hints and giving up | `POST /games/:id/hints`, `POST /games/:id/give-up` |
| Dictionary | `GET /word-lists/dictionary?q=word`, `GET /word-lists/dictionary/:term/definition` |
| Collections and saved words | `GET /collections`, `GET /collections/:slug/words`, `GET /word-lists/mine` |
| Statistics | `GET /progress/summary` |
| Coin leaderboard | `GET /community/coin-rankings` |
| Feedback | `POST /feedback` |

Data attribution and license notices: [licenses](apps/web/public/licenses/).
