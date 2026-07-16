# BeaconNest

A Chrome extension that drops a beacon on the exact spot on a page, not just
the page — synced instantly between you and a colleague via Supabase.

## What it does

1. **Click the toolbar icon** on any page. BeaconNest captures a screenshot of
   the current viewport and works out the nearest anchor point — the element
   at the center of your screen, plus your scroll position and (if you had
   text selected) the exact selected text.
2. **Add a short note** in the popup before saving. Edit it anytime later from
   the "All beacons" manager page.
3. **Save it.** The screenshot goes to Supabase Storage, the rest of the
   metadata (URL, title, note, anchor selector, scroll position, who saved it)
   goes into a Supabase Postgres table. Every beacon is tagged with your name
   (set once, the first time you use it) so teammates know who left it, and
   you can filter the manager page by person. Both of you see each other's
   beacons appear live — no refresh needed — via Supabase Realtime. You can
   export everything to CSV from the manager page at any time.

When you revisit a beacon ("Go there"), BeaconNest opens the page and:
- uses a native browser text fragment (`#:~:text=`) to jump straight to the
  selected text if there was any, or
- falls back to the saved CSS selector for the nearest element, scrolling it
  into view and briefly highlighting it, or
- as a last resort, scrolls to the raw saved scroll position.

## One-time setup (do this once, for the two of you)

### 1. Create a Supabase project
Go to [supabase.com](https://supabase.com) → New project. Free tier is plenty
for two people. Note your project's region — pick one close to both of you.

### 2. Run the setup SQL
Open **SQL Editor → New query** in your Supabase dashboard, paste the contents
of `supabase-setup.sql` (included in this folder), and run it. This creates
the `beacons` table, row-level security policies, enables Realtime on the
table, and creates the `screenshots` storage bucket. (If you're upgrading from
the old Spotmark setup, this same script renames your existing `bookmarks`
table to `beacons` in place — nothing is lost.)

### 3. Add an account for each teammate
**Authentication → Users → Add user** — create one user (email + password) per
person. This is the simplest auth setup for two known people; no public
sign-up flow is exposed.

### 4. Grab your API keys
**Project Settings → API** — copy the **Project URL** and the **anon public**
key. Share both with your colleague (these aren't secret admin keys — they're
the public client keys Supabase is designed to have distributed).

## Install the extension (each person does this)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `spotmark` folder.
4. Pin the extension from the puzzle-piece menu so the icon stays visible.
5. Click the icon → **All beacons** → **Connection** → paste the Project URL
   and anon key → **Save** → sign in with the email/password from step 3 above.
6. The first time you save a beacon, you'll be asked for your name — it's
   tagged on every beacon you save from then on and can be changed anytime
   from **Connection → Your name** on the manager page.

## Using it

- **Save a beacon:** browse to the spot you care about (optionally select some
  text first for the most precise anchor), click the BeaconNest icon, add a
  note, click **Save this beacon**. Your colleague sees it appear immediately.
- **View / edit / delete beacons:** click **All beacons** in the popup, or
  right-click the extension icon → **Options**. Notes are editable inline and
  save automatically. Use the **All people** dropdown next to search to filter
  down to beacons saved by one person.
- **Export:** click **Export CSV** on the manager page — metadata only
  (title, URL, note, anchor info, who saved it, timestamps). Screenshots stay
  in Supabase Storage since CSV isn't a great fit for binary images.

## Known limitations

- The screenshot is the **visible viewport only**, not the full scrollable page.
- Browser-internal pages (`chrome://`, the Chrome Web Store, etc.) can't be
  captured — a Chrome platform restriction on all extensions.
- The "nearest element" anchor is a best-effort CSS selector. Pages that heavily
  rebuild their DOM (some SPAs) may occasionally fail to resolve the old
  selector — BeaconNest falls back to the raw scroll position in that case.
- The display name tagged on each beacon is free-text and self-reported (not
  tied to Supabase auth) — fine for a small, trusted team, but not a verified
  identity.
- Auth is simple email/password for a small, known pair of users. If you later
  want more people or SSO, Supabase supports that — just extend the Users setup.

## File structure

```
spotmark/
├── manifest.json
├── background.js           # minimal service worker
├── content.js               # injected into every page: anchor detection + scroll-to
├── supabase-setup.sql        # run once in the Supabase SQL Editor
├── lib/
│   ├── vendor/supabase.js     # bundled Supabase JS client (no CDN — MV3 CSP)
│   ├── config.js               # connection config, auth helpers, display-name storage
│   └── data.js                  # beacons CRUD, screenshot storage, realtime
├── popup/                    # toolbar popup: capture + save UI
├── manager/                   # "All beacons" page: list, search, filter by person,
│                                 edit, delete, export, connection/sign-in panel
└── icons/
```
