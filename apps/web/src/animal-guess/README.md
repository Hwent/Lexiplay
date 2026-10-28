# AI Guess

Free, browser-run animal guessing for B1–B2 learners. No model calls or coin changes.
The 50-animal knowledge set is curated; Chinese names reference
[ECDICT](https://github.com/skywind3000/ECDICT). Only the animal meaning is used.
English definitions, questions and contextual keyword glosses are written for this game;
there are no example sentences. ECDICT's notice is in `/licenses/ECDICT-LICENSE.txt`.
Reference CSV SHA-256: `d1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc`.

`knowledge.ts` describes typical adults. A listed `yes` feature is positive,
`unknown` is variable or ambiguous, and other features are negative. Check **all**
features when adding an animal, and add aliases when several names denote the same
playable category (for example, `hippo` / `hippopotamus`). Breeds are not separate answers.

`engine.ts` recomputes weights from the answer history. Known matches multiply
by 1.8, mismatches by 0.2; Unknown and Not Sure leave weights unchanged. Scores are
computed in log space and normalized for selecting questions by expected information
gain. These are ranking weights, not calibrated real-world confidence percentages.
After at least four questions, a weight of 0.72 triggers an early guess. Otherwise,
up to 15 feature questions are asked; all three guess opportunities remain available.
Rejected guesses are excluded. Editing the last answer preserves the guess count.

Progress is versioned in local storage and survives refreshes on the same browser.
There is no cross-device game history. Saved vocabulary uses the existing pending-word
flow. Optional failed-round feedback uses `POST /feedback`, including the supplied
answer and round history for manual review; it never updates the knowledge set automatically.

Run the dataset simulations and UI checks with:

```sh
pnpm --filter @lexiplay/web exec vitest run src/animal-guess
```
