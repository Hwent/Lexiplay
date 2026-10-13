# Documentation index

Start with the guide for the task you want to perform. Active guides describe current implementation; reference and archive records have narrower scopes.

| Task | Guide |
| --- | --- |
| Run locally and follow coding conventions | [Development](DEVELOPMENT.md) |
| Connect to databases, update data, back up, recover, or keep environments parallel | [Database manual](DATABASE-MANUAL.md) |
| Configure and release the Render application | [Deployment](DEPLOYMENT.md) |
| Understand games, accounts, Statistics, and email | [Games and accounts](GAMES_AND_ACCOUNTS.md) |
| Learn file responsibilities and request flows | [Codebase tour](learn.md) |
| Understand product requirements and planned work | [Product requirements](../outputs/docs/PRD.md) |
| Understand architecture intent and future design | [Technical design](../outputs/docs/TECHNICAL_DESIGN.md) |
| Understand personal-list behavior and API contracts | [Word-list design](../outputs/docs/WORD_LIST_DESIGN.md) |

## Reference material

- [Dictionary source decision](reference/DICTIONARY-SOURCE-REVIEW.md): historical provider comparison and the Simple English Wiktionary choice. Preserve source/license references; provider terms must be rechecked before a new integration.
- [Original React template](reference/REACT-TEMPLATE.md): supplied scaffolding reference, preserved as written. It is not an instruction to replace this project's TypeScript, navigation, or styling architecture. Current conventions are in Development.

## Historical records

- [Deployment checks, 2026-10-12](archive/DEPLOYMENT-CHECKS-2026-10-12.md): tests, dictionary counts, and deployment conditions observed on that date.
- [Implementation milestones](archive/IMPLEMENTATION-MILESTONES.md): earlier feature validation and changed-file reports; test totals are historical.

## Organization and maintenance

Database procedures live in the database manual; code release settings live in Deployment; product behavior lives in the feature/design guides. Other guides should link to these procedures instead of maintaining alternate command sequences. Keep historical evidence under `archive` and supplied research/templates under `reference`. Do not store credentials, live account records, or database archives in documentation.

The former `PARALLEL-DEVELOPMENT.md` was merged into the database manual. The obsolete React evaluation was removed; compatible conventions are retained in Development. No source/license notices were removed.
