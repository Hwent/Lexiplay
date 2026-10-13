# Render demo checks — 2026-10-12

Historical observation, not current deployment status, credentials, plan settings, or test totals. Use [Deployment](../DEPLOYMENT.md) and the [database manual](../DATABASE-MANUAL.md) for current procedures.

The demo at https://lexiplay.onrender.com is running commit `7b5a6f9`. The first dictionary import completed against `lexiplay-demo-db` in Oregon using verified TLS. It committed **42,462 dictionary entries** from Simple English Wiktionary. The imported definition of `because` was also checked through the live website.

## Live API and database checks

An isolated account was used for 23 successful checks before cleanup:

- Passwords shorter than eight characters are rejected. Registration without email or verification succeeds.
- Session cookies include HttpOnly, Secure, SameSite=Lax, and `/api/v1` scope.
- Username login, email login, and authenticated account lookup succeed.
- Invalid game guesses do not consume an attempt.
- A guest game, accepted guess, both hint types, and saved word transfer to the account. Repeating the same transfer does not duplicate progress.
- Saved games, guesses, hint counts, and word status remain after logout and login. Direct PostgreSQL reads confirm account ownership and stored guesses.
- All 21 word-length/difficulty combinations start with the expected guess and hint limits.
- A completed game appears in Statistics with the correct win and streak counts.
- Verification and recovery messages arrive at the requested test recipient. Links use the deployed HTTPS account page and include expiry and single-use notices.
- Verification and recovery links succeed once and reject reuse. Recovery invalidates earlier sessions; email login with the new password succeeds.
- A second recovery after saving progress preserves the completed game and saved word.

| Word length | Playable dictionary words |
| --- | ---: |
| 3 | 514 |
| 4 | 1,878 |
| 5 | 3,317 |
| 6 | 4,655 |
| 7 | 5,934 |
| 8 | 6,135 |
| 9 | 5,641 |

The user approved deletion of the isolated test account. Two further cleanup checks confirmed its session was invalid and its account-owned games were removed, while the dictionary count and other account count stayed unchanged. The test recipient is available for a new signup.

## Interface checks and limits

The deployed dictionary search displays the imported definition, and the account page's password visibility control switches between text and password input types. All **49 existing frontend tests passed**, including account and guest progress components. The live progress-transfer check exercised the API; it did not automate a full browser signup with local storage.

The verification message was found in Gmail Spam. The later recovery message arrived in Inbox. The demo still uses the restricted Resend onboarding sender: general recipients require a verified sender domain. No deliverability claim is made for other email providers or recipients.

The Free PostgreSQL instance expires on **2026-11-11**. This walkthrough did not configure backups, replace the free database, restrict external network rules, or rotate the credentials flagged during the earlier setup. Those remain launch follow-ups. Temporary database URLs and test credentials are kept in gitignored local files; no secret or account-action link is included in this record.
