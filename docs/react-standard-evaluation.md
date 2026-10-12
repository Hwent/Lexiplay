# React standard evaluation and LexiPlay conventions

Updated: 2026-10-11

The supplied [react-standard.md](react-standard.md) is a useful template for a new React project, but it is not a complete standard for this existing application. It still contains choices such as `Build []`, React `[18/19]`, Vite/Create React App, and JavaScript/TypeScript. LexiPlay already uses React 19, TypeScript, and Vite. Its instructions to print every file and ask questions belong to the template's generation workflow, not the app's runtime behavior or this evaluation.

Apply compatible conventions while preserving the project architecture. Read [DEVELOPMENT.md](DEVELOPMENT.md) for web/API boundaries and [learn.md](learn.md) for the code tour. The original supplied template is retained separately so that this evaluation does not silently redefine its requirements.

## Evaluation against the existing code

| Template rule | Current LexiPlay implementation | Decision for this update |
| --- | --- | --- |
| Exact `index.js`, `App.js`, pages/components/hooks/context/services/styles tree | `main.tsx` mounts React; `App.tsx`, `AccountPanel.tsx`, and `WordListsPanel.tsx` own cohesive features. | Keep the TypeScript entry point and component layout. Add `services/` for the shared HTTP responsibility; the full template tree is not implemented. |
| React Router v6, a routes file, Layout/Outlet, ProtectedRoute, and NotFound | `App.tsx` uses `sectionPaths`, `history.pushState`, and `popstate`. Guest vocabulary lists are deliberately available without login. | Keep current navigation and guest access. A router migration would add a dependency and must preserve the route-change event that flushes pending word edits. No protected routes or NotFound route were added. |
| Pages load data; reusable components receive props | Existing feature components own their data loading, input state, and presentation; small helpers stay nearby. | Continue the existing feature boundaries. Extract reusable behavior when it has a concrete responsibility rather than moving every file to satisfy a tree. |
| CSS Modules beside components; global CSS only for resets/fonts/variables | `styles.css` holds responsive layout, component styles, and themes. | Keep established classes and stylesheet organization. CSS Modules remain a possible separate migration, not a requirement applied by this change. |
| Lazy-load non-trivial pages with one Suspense boundary | Feature panels are imported directly. | No lazy loading added. Evaluate a measured bundle or loading problem before changing navigation and loading behavior. |
| Shared state in context/hooks, API calls in services, loading/error states | Components use hooks and refs; the dictionary cache is a separate module. Four HTTP implementations were duplicated. | Consolidate HTTP transport in `services/api-client.ts`. Keep feature state, canonical caching, guest storage, and messages in their current owners. No Context provider or custom-hook layer is needed for this refactor. |
| Function components, hooks, default component exports, descriptive names, small files | Existing components already use hooks, PascalCase names, and default exports. Utilities use named exports and lowercase hyphenated filenames. `App` and `WordListsPanel` remain substantial feature files. | Preserve naming and formatting; remove the duplicate HTTP helpers. Large components remain a known gap relative to the template's small-file goal. |

The standard is strongest on explicit boundaries, reusable components, and visible loading/error states. Its exact directory tree, router version, and styling system are implementation choices rather than evidence that the current architecture is incorrect. It also needs guidance on effect cleanup, accessibility, immutable state, and tests; the conventions below fill those gaps for LexiPlay.

## Files and responsibilities after this update

```text
apps/web/src/
├── main.tsx                 React mounting and shared style import
├── App.tsx                  Shell, History API navigation, game UI
├── AccountPanel.tsx         Account forms and messages
├── WordListsPanel.tsx       Personal lists, queued edits, import UI
├── dictionary-cache.ts      Canonical dictionary cache and request sharing
├── services/
│   ├── api-client.ts        HTTP transport and status-bearing errors
│   └── api-client.test.ts   HTTP boundary checks
├── styles.css               Existing responsive styling and themes
└── *.test.ts / *.test.tsx   Colocated feature tests
```

All four consumers use [`apiRequest<T>`](../apps/web/src/services/api-client.ts). `App` imports it as `api`, and `WordListsPanel` imports it as `request` to preserve their established call sites. The dictionary cache keeps its feature-specific request wrapper but delegates HTTP handling to the service. Browser code does not import server repositories or business rules.

## Conventions to follow in existing files

- Use PascalCase `.tsx` filenames with a matching default component export. Use named utility exports and lowercase hyphenated `.ts` utility filenames. Follow the existing two-space indentation, single quotes, semicolons, and TypeScript `type` aliases; avoid unrelated file-wide reformatting.
- Use `useState` for rendering state and derive computed values during rendering where practical. Use functional updates when the next state depends on the previous state. Replace arrays, objects, maps, and sets instead of mutating state in place.
- Use `useRef` for DOM references and bookkeeping that should not render, such as pending word operations. Keep user-triggered actions in event handlers. Use effects for requests, storage, timers, and browser events, with cleanup and guards against stale asynchronous results.
- Preserve `lexiplay:before-route-change`: it flushes queued signed-in edits. Guest personal lists remain in browser storage. Seeing an optimistic edit does not mean PostgreSQL has already saved it.
- Keep loading, success, and error states visible; clear busy state in `finally` for asynchronous actions. Keep canonical dictionary definitions separate from personal notes.
- Prefer semantic controls, labeled inputs, accessible names for icon buttons, appropriate status messages, and feedback beyond color. Preserve keyboard and focus behavior when extracting components. Decorative SVGs should remain hidden from assistive technology.
- Keep UI-specific types local. API authentication, authorization, validation, puzzle rules, and persistence remain on the server. Client-side checks improve feedback and do not replace server checks.

## The API service boundary

Pass a path relative to `/api/v1` and an expected response type:

```ts
const word = await apiRequest<WordEntry>(`/word-lists/${listId}/words/${wordId}`, {
  method: 'PATCH',
  body: JSON.stringify({ status: 'KNOWN' }),
});
```

The service owns the prefix, same-origin credentials, JSON headers and parsing, HTTP failures, and empty 204 responses. It preserves caller headers. Uploads pass `FormData` without setting a content type, allowing the browser to generate the multipart boundary. `ApiError.status` supports the word-list panel's 401 guest fallback; optional fallback messages keep account and dictionary errors relevant. Server validation-message arrays become readable text. Network failures and malformed successful JSON still reject the request.

Feature code owns caching, retry decisions, navigation, and guest storage. `T` expresses a compile-time expectation, not runtime validation of JSON. The browser `ApiError` class is distinct from the API error payload type in `packages/shared`. Comprehensive shared response contracts are not currently implemented.

## Verification and remaining gaps

Use colocated Vitest tests with Testing Library, `userEvent`, jsdom, and deterministic API responses. Prefer roles and accessible names over implementation selectors; restore mocked globals after each test. Check error and guest paths as well as successful interactions.

The API service tests cover JSON headers and credentials, multipart uploads, empty responses, validation errors, unauthorized non-JSON responses, malformed JSON, and network failures. Existing feature tests exercise account creation, games, personal lists, and dictionary caching.

Run `pnpm test`, `pnpm typecheck`, and `pnpm build` after changes across features. No dependency changes are required for this update. The exact scaffold, React Router, CSS Modules, lazy page loading, Context providers, runtime response validation, and further component decomposition remain unapplied. Current checks use a simulated browser; no separate real-browser journey suite or lint/format command is configured in the root workflow.
