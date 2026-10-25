# LexiPlay

LexiPlay helps learners build English vocabulary through word games, dictionary lookup, and saved practice.

## App

- **Word Guess:** find a hidden 3–9-letter word, with difficulty options and definition hints.
- **Word Ladder:** make four new words by changing one letter at a time; choose four or five letters.
- **Vocabulary:** explore curated collections, look up definitions and pronunciation, and save words to personal lists.
- **Progress:** track completed games, wins, and practice streaks; transfer guest progress after signing in.
- **Community:** rank the top 20 accounts by coin balance, showing only each username’s first letter.
- **Settings:** English or Chinese interface, themes, text size, and sound.

Games cost 1 coin. Word Guess wins award 4–6 coins by difficulty; Word Ladder wins award 4 or 5 coins by word length. New accounts receive 100 coins.

## API

Base path: `/api/v1`. Requests and responses use JSON. Cookie sessions identify accounts and guests; personal lists and statistics require sign-in.

| Function | Main endpoints |
| --- | --- |
| Accounts | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| Games | `POST /games`, `GET /games/:id`, `POST /games/:id/guesses` |
| Hints and giving up | `POST /games/:id/hints`, `POST /games/:id/give-up` |
| Dictionary | `GET /word-lists/dictionary?q=word`, `GET /word-lists/dictionary/:term/definition` |
| Synonyms and antonyms | `GET /word-lists/dictionary/:term/thesaurus` |
| Collections and saved words | `GET /collections`, `GET /collections/:slug/words`, `GET /word-lists/mine` |
| Statistics | `GET /progress/summary` |
| Coin leaderboard | `GET /community/coin-rankings` |
| Feedback | `POST /feedback` |

Data attribution and license notices: [licenses](apps/web/public/licenses/).
