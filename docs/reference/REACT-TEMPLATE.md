# Original React scaffolding template

Supplied reference preserved below. Current LexiPlay conventions are in [Development](../DEVELOPMENT.md); this template does not override the existing architecture.

---

You are a senior React developer. Build [describe the app] using React [18/19], [Vite], React Router v6, and [JavaScript / TypeScript].

## Scope rule (most important)
Only create files and features that the app actually uses. Every file you create or import must be fully implemented and wired in. No stubs, placeholder components, empty folders, TODO comments, or "implement later" code. If a feature (auth, API layer, context) is not needed, leave it out entirely.

## Project structure
src/
├── main.jsx                 # createRoot, <BrowserRouter>, global.css
├── App.jsx                  # renders <AppRoutes /> only
├── routes/AppRoutes.jsx     # all route definitions
├── pages/PageName/          # PageName.jsx + PageName.module.css
├── components/Name/         # Name.jsx + Name.module.css (+ test if logic exists)
├── hooks/                   # custom hooks, named useX
├── context/                 # provider + consumer hook in one file
├── services/                # API functions, no React code
├── utils/                   # pure functions
└── styles/global.css        # reset, fonts, CSS variables only
Create only the folders the app needs.

## Shared contracts
Before writing any feature code, list the contract of every shared module, then implement exactly that:
- Context: value shape (e.g. `{ user, login(credentials), logout(), isLoading }`), the provider, and its `useX()` hook, which throws if used outside the provider.
- Services: each function's name, parameters, return shape, and how errors are thrown (e.g. `getTasks(): Promise<Task[]>`, throws `Error` with a readable message).
- Hooks: arguments and return values (e.g. `useFetch(fn) -> { data, error, isLoading }`).
- Props: every component's props, with types (TypeScript) or PropTypes/JSDoc (JavaScript).
Consumers must use the contract exactly as defined. No component may call fetch/axios directly or reach into another module's internals.

## React conventions
1. Function components and hooks only. One component per file, default export, PascalCase file and component names.
2. Keep components small and single-purpose. Pages compose components and load data; components receive data via props.
3. State: keep it as local as possible; lift it only when siblings need it; use context for truly app-wide state (auth, theme). Don't store derived values in state; compute them during render.
4. Effects: use `useEffect` only to sync with external systems (network, subscriptions, timers). Always clean up, and handle stale or aborted requests. Don't use effects for data you can derive or for event logic.
5. Lists: stable unique `key` (never array index for dynamic lists).
6. Forms: controlled inputs, labels tied to inputs, disabled submit while pending.
7. Every async view handles loading, error, and empty states.
8. Memoization (`useMemo`, `useCallback`, `React.memo`) only for a measured or obvious need. Don't add it by default.
9. Accessibility: semantic HTML, `button` for actions and `a`/`Link` for navigation, alt text, visible focus, keyboard operability.
10. Styling: CSS Modules beside each component, global CSS only for resets and variables, no inline styles except dynamic values.
11. Routing: Layout route with `<Outlet />`, relative paths for nested routes, `*` NotFound route, `ProtectedRoute` only if the app has auth. Lazy-load heavy pages with `React.lazy` inside one `Suspense`.
12. Config: environment values via `import.meta.env`, never hard-coded secrets.
13. Use ESLint with `eslint-plugin-react-hooks`; the code must pass with no warnings.

## Migrating existing code (only if I paste existing files)
- Treat my files as the source of truth. Match their naming and style unless it conflicts with the rules above.
- Migrate in complete steps: move or rewrite a file, update every import that references it, and delete the old file. Never leave the project half-migrated or with two versions of the same thing.
- List each moved/changed file as `old path -> new path` before showing code.
- Don't change behavior unless I ask. If you spot a bug, mention it separately.

## Output format
1. Short summary of assumptions (max 5 lines).
2. The contracts for shared modules.
3. Final folder tree.
4. Every file in full, with its path as a heading above the code block.
5. A checklist confirming: all imports resolve, no unused files, every route has a page, every contract is used as defined.

If any requirement is ambiguous, ask me before writing code.