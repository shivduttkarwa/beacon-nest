# AGENTS.md — BeaconNest

Context for any AI agent (or human dev) picking up this codebase. `README.md`
is the end-user install/setup guide; this file is the engineering map.

(This project shipped its first version as "Spotmark" — some file/folder
names and the Supabase storage bucket id still say `spotmark`/`screenshots`
for continuity; see "Naming notes" below.)

## What this is

A Manifest V3 Chrome extension. Click the toolbar icon on any page → it
screenshots the visible viewport, works out the nearest DOM element to screen
center as an "anchor point," lets the user attach a short note, and saves all
of it as a **beacon**. The first time an install saves a beacon, it's asked
for a display name, which gets tagged onto every beacon it saves from then on
— this is what powers the "filter by person" dropdown in the manager UI. A
second user (colleague) sees new/edited/deleted beacons appear live via
Supabase Realtime. Revisiting a beacon reopens the page and jumps back to the
saved spot.

No build step. No bundler, no TypeScript, no framework. Plain JS files loaded
via `<script>` tags in that exact order — order matters, see below.

## Tech stack

- Manifest V3 Chrome extension (popup + options page + content script + service worker)
- Supabase: Postgres table (`beacons`), Storage bucket (`screenshots`), Auth (email/password), Realtime (`postgres_changes`)
- Supabase JS client v2, vendored as a UMD build at `lib/vendor/supabase.js` — **not** loaded from a CDN, because MV3's default CSP for extension pages blocks remote script execution (`script-src 'self'`). If this file ever needs updating: `npm install @supabase/supabase-js` somewhere, then copy `node_modules/@supabase/supabase-js/dist/umd/supabase.js` in as-is. It exposes a global `supabase.createClient(...)`.
- No npm/build pipeline ships in the extension itself — `lib/vendor/supabase.js` is a committed artifact, not fetched at runtime.

## Data flow

```
popup click
  → content.js finds anchor (nearest element to viewport center, or user's
    text selection) + scroll position
  → chrome.tabs.captureVisibleTab() screenshots the viewport
  → if this install hasn't set a display name yet, popup.js prompts for one
    first (stored locally, reused on every future save)
  → lib/data.js: beaconnestAddBeacon()
      → uploads screenshot PNG to Supabase Storage bucket "screenshots"
      → inserts a row into Postgres table "beacons" (tagged with the
        display name in created_by_name)
  → Supabase Realtime broadcasts the INSERT to every subscribed client
  → colleague's open manager.js tab receives it via beaconnestSubscribe()
    and prepends it to the grid, no reload
```

Revisit flow ("Go there" in manager.js):
```
chrome.tabs.create(beacon.url)   ← URL opened EXACTLY as captured, including
                                   the page's own #hash (hash-routed SPAs
                                   need it to land on the right view)
  → on tab onUpdated status:'complete', send BEACONNEST_SCROLL_TO to
    content.js with the full anchor payload (selectedText, snippet,
    selector, scrollX/Y, scrollYRatio); if the message fails (content
    script missing, e.g. extension reloaded), inject content.js via
    chrome.scripting and retry once
  → content.js revisitAnchor() then owns everything:
    1. TEXT: search the rendered page for selectedText/snippet using a
       normalized cross-node character index (buildTextIndex); polls up to
       5s for late-rendering content; validates matches are visible;
       when the text occurs multiple times, picks the occurrence closest
       to scrollYRatio × page height
    2. SELECTOR: document.querySelector(beacon.selector), if it resolves
       to a visible element
    3. POSITION: scrollYRatio × current scrollable height (ratio, not raw
       pixels — page height differs between visits), else raw scrollY
    All three scroll via an ANIMATED sweep (not an instant jump) with
    settle-and-correct passes, then flash an overlay highlight.
```

Why content.js owns the revisit (not native #:~:text= fragments, which a
previous iteration used): this tool's primary use case is bookmarking spots
on heavily animated/inspiration-style sites and non-English pages, and
native text fragments fail there in several ways — word-boundary matching
rules break CJK and other languages, split-text animations (one span per
character) defeat matching, only the first occurrence is ever targeted,
failure is silent, and the instant jump skips past scroll-reveal animations
so sections that reveal on scroll stay invisible and the page looks broken.
The in-page finder in content.js addresses each of those: plain substring
matching over a normalized character index (no word boundaries, spans
irrelevant), occurrence disambiguation by saved position, explicit fallback
when no match, and an animated scroll that fires real scroll events along
the way so IntersectionObserver / GSAP ScrollTrigger reveals run normally.

## File map

| File | Role |
|---|---|
| `manifest.json` | MV3 config. Note `content_security_policy.extension_pages` explicitly allows `connect-src` to `*.supabase.co` (https + wss) — required for the Postgres/Storage/Realtime calls from popup and manager pages. |
| `background.js` | Near-empty service worker. All actual logic lives in popup/manager since they have tab context; kept only because MV3 requires a service worker to be declared. |
| `content.js` | Injected on every page (`document_idle`, `<all_urls>`). Two message handlers: `BEACONNEST_GET_ANCHOR` (capture: visible-text snippet via `caretRangeFromPoint` + visible-subtree walk, CSS selector, scroll ratio) and `BEACONNEST_SCROLL_TO` (revisit: in-page text search over a normalized cross-node character index → selector → scroll-ratio fallback, all via animated scroll with settle-correction, overlay highlight, and user-takeover abort — see "Revisit flow" above). Guards against double-injection with `window.__beaconnestInjected`. |
| `lib/vendor/supabase.js` | Vendored Supabase JS UMD bundle. Don't hand-edit; replace wholesale if upgrading. |
| `lib/config.js` | Reads/writes `{url, anonKey}` to `chrome.storage.local` under key `beaconnestSupabaseConfig`. Creates and caches the Supabase client (`beaconnestGetClient()`). Auth helpers: `beaconnestSignIn`, `beaconnestSignOut`, `beaconnestGetSession`. Also owns the per-install display name (`beaconnestGetUserName`/`beaconnestSetUserName`, stored under `beaconnestUserName`) — independent of Supabase auth, kept simple deliberately. Session persistence relies on each extension page's own `localStorage` (popup and manager are separate stable origins within the extension — this works, but note popup's localStorage session and manager's are technically separate storage areas that both point at the same Supabase project; Supabase's client re-validates via refresh token so this hasn't caused issues, but keep in mind if adding a third context, e.g. background). |
| `lib/data.js` | All Postgres/Storage/Realtime calls. Beacon rows use snake_case in the DB (`selected_text`, `scroll_x`, `created_by_name`, etc.) and are mapped to camelCase JS objects via `beaconnestRowToBeacon()`. **Always go through this mapping function** — don't read raw Supabase rows elsewhere. |
| `popup/*` | Toolbar popup. State machine via `showState()`: `loading → ready` (happy path) or `→ error` (unsupported page, e.g. `chrome://`) or `→ signin` (no Supabase session) or `→ name` (session exists but no display name set yet — asked once, then skipped on future opens) or `→ saveError` (insert/upload failed). |
| `manager/*` | Options page ("All beacons"). Has its own mini state machine for connection status (`refreshConnectionUI()`): not-configured → not-signed-in → signed-in. Subscribes to realtime only once signed in; unsubscribes on sign-out. Search box and the "All people" `<select>` (`personFilterEl`, populated from distinct `createdByName`/`createdByEmail` values across loaded beacons) combine with AND logic in `applyFilter()`. |
| `supabase-setup.sql` | Idempotent (uses `drop policy if exists`, `on conflict`, existence-check `do $$` blocks) — safe to re-run. Creates table `beacons`, RLS policies (any `authenticated` user can read/write all rows — there's no per-user row ownership restriction, by design, since it's a 2-person shared space), storage bucket (`public: true`, so screenshot URLs are plain public URLs, not signed — reconsider if this ever needs to be private). Also transparently renames a pre-existing `bookmarks` table (the old Spotmark schema) to `beacons` in place, preserving data. |

## Naming notes

- All shared/global functions are prefixed `beaconnest` (no module system, everything lands in the page's global scope, so this prefix is the only thing preventing collisions). The product/UI vocabulary is "beacon" (not "bookmark" or "spot") — keep new code and copy consistent with that.
- A few things intentionally still carry the old `spotmark`/`screenshots` naming and were left alone rather than churned for cosmetics:
  - The **root folder** is still named `spotmark` — renaming it would just be filesystem churn with no functional effect.
  - The Supabase **storage bucket id** is still `screenshots` (see `lib/config.js`'s `BEACONNEST_BUCKET` constant and `supabase-setup.sql`) — Supabase Storage doesn't support cheaply renaming a bucket in place the way `alter table rename` works for Postgres, and there's no user-facing exposure of the bucket id, so it wasn't worth a bulk object-copy migration.
  - Existing installs that ran the old Spotmark setup have their local `chrome.storage.local` config under the old key (`spotmarkSupabaseConfig`); the new build reads `beaconnestSupabaseConfig` instead, so a one-time re-paste of the (non-secret) Project URL + anon key is needed after upgrading. The Supabase-side data itself is preserved by the `supabase-setup.sql` rename step.
- Script load order in both `popup.html` and `manager.html` is fixed: `vendor/supabase.js` → `config.js` → `data.js` → page-specific script. `data.js` and `config.js` assume the previous ones already ran.
- CSS variables (`--ink`, `--paper`, `--accent`, etc.) are duplicated identically in `popup.css` and `manager.css` rather than shared — there's no build step to share them. Keep both in sync if the palette changes. Accent color `#0F7B6C` (teal) is the brand mark; the pin/anchor SVG motif is reused in the toolbar icon, popup thumbnail overlay, and manager card thumbnails. (The icon PNGs in `icons/` are still the original Spotmark pin artwork — a rebrand pass on those is a manual/design follow-up, not something done as part of the code rename.)

## Known gaps / things a future change might need to address

- **No offline fallback.** Everything requires a live Supabase connection; there's no local queue if a save fails while offline.
- **Screenshot storage is public.** Anyone with a screenshot's URL can view it (bucket is `public: true`). Fine for two trusted colleagues; would need signed URLs + private bucket for anything more open.
- **RLS is owner-only for write, shared for read.** Every authenticated user can read every beacon, but `update`/`delete` policies on both `beacons` and `storage.objects` require `created_by = auth.uid()` (see `supabase-setup.sql`). The manager UI mirrors this: `manager.js` compares `beacon.createdBy` to the signed-in user's id and only renders the Delete button / editable note textarea for the owner. There's no admin override yet — nobody can moderate someone else's beacon; would need a roles/admin table if that's ever needed.
- **No pagination.** `beaconnestGetAllBeacons()` fetches the entire table every time the manager page loads. Fine at dozens/hundreds of beacons; would need pagination or virtualization well before thousands.
- **Full-page screenshots aren't supported** — only the visible viewport (`chrome.tabs.captureVisibleTab`). This was a deliberate scope cut, documented in `README.md`, not an oversight.
- **The CSS selector (`content.js` `buildSelector()`) is best-effort and rarely the thing doing the work anymore.** Revisiting runs content.js's own in-page text search first (see "Revisit flow"); the selector is only consulted when the beacon has no usable text anchor (e.g. centered on an image or canvas with no nearby visible text), and raw scroll ratio after that. Sites that fully hijack scrolling with transform-based fake scroll (Locomotive-style, where `window.scrollY` never changes) remain the one case none of the fallbacks can position correctly — the captured scroll ratio is 0 there and programmatic `window.scrollTo` does nothing visually.
- **Auth is just email/password**, manually provisioned per user via the Supabase dashboard. No signup UI, no SSO. Deliberate for a 2-person tool; would need rework to onboard more people self-service.
- **Display name is unverified free text**, stored per-device in `chrome.storage.local` and not tied to the Supabase auth identity. Someone could type any name, and reinstalling/clearing extension storage resets it (they'd just be asked again on next save). Fine for a small trusted team; would need to move to a real profile record (keyed off `auth.users`) if that ever becomes a problem.
- **Full standalone web dashboard is explicitly out of scope for now** — deferred by the project owner, not forgotten. Today's "manager" page only exists as the extension's options page (`chrome-extension://.../manager/manager.html`), opened via `chrome.runtime.openOptionsPage()` — there is no hosted, publicly-reachable web app version of it yet. If that gets picked back up, expect questions about: framework choice (stay vanilla-JS/no-build to match the extension, or move to a bundled stack), hosting, and whether it replaces `manager/` or lives alongside it.

## How to test changes locally

1. `chrome://extensions` → Developer mode → Load unpacked → select this folder.
2. After editing any file, go back to `chrome://extensions` and click the reload icon on the BeaconNest card. Content script changes also require reloading the target tab (open pages have the old content.js already injected).
3. Debug consoles:
   - Popup: right-click the toolbar icon → Inspect popup (only available while popup is open).
   - Manager page: it's a normal tab, just open DevTools on it.
   - Service worker: `chrome://extensions` → BeaconNest → "service worker" link.
4. There's no automated test suite. `node --check <file>.js` is the only currently-used sanity check (catches syntax errors only, since these files depend on the `chrome.*` and `supabase` globals that don't exist under plain Node).
