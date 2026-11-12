# J-Pay Display-Alignment Contract — Research Deliverable

Scope: enumerate every visible UI surface, the geometric assertion contract,
and the Puppeteer (puppeteer-core 25.8.0) mechanism for asserting it. This is
a research deliverable for a follow-up test-writing task. **No tests are
written, no files are edited.**

Conventions:
- All line numbers cite the live source files in `src/app/`.
- Container widths use Puppeteer's `page.setViewport({...})` which controls
  `window.innerWidth/Height`. The `iPhone 13/14` emulation is **375x812 with
  `isMobile: true` and `deviceScaleFactor: 2`** — the repo has not adopted
  `page.emulate()` yet (existing `layout-assert.mjs` only sets
  `setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 })` per
  `tests-layout/layout-assert.mjs:42`), so the new file should
  `await page.setViewport(...)` per test rather than rely on `emulate()`.
- The dev/branch path modes: `JPAY_BASE_URL` (default `http://localhost:3000`,
  per `tests-layout/layout-assert.mjs:23`).
- The project's own pattern for getting geometry is the
  `page.evaluate(() => el.getBoundingClientRect())`/`getComputedStyle(...)`
  idiom (no Playwright APIs, no locator geometry helpers).
- `el.checkVisibility()` is **not yet available** in puppeteer-core 25.8.0
  (it landed in Chromium 121 stable; puppeteer-core 25.x ships Chromium 131
  but the JS-side helper `el.checkVisibility()` is exposed as a function on
  HTMLElement only when the page is the same Chrome). It *is* available in
  Chrome 131+ — safe to call, but degrade gracefully. Fallback: read
  `getComputedStyle(el).display !== "none" && visibility !== "hidden" &&
  offsetWidth/Height > 0`.
- All "above the fold" assertions measure `rect.bottom` against
  `window.innerHeight` (not `document.documentElement.clientHeight`) because
  the layout uses `min-h-dvh` (`src/app/layout.tsx:27`,
  `src/app/page.tsx:99`).
- "Not overlapping" is implemented by computing axis-aligned bounding
  rects and checking for non-intersection along the relevant axis (see
  helper spec in §H).

---

## Source map (what was read)

| File | Why | Key contracts |
|---|---|---|
| `src/app/globals.css` (1 line) | Only `@import "tailwindcss"` — all styling is utility-class. | No custom CSS to assert against. |
| `src/app/layout.tsx:16-20` | viewport meta: `themeColor #0a0a0a`, `width=device-width`, `initialScale: 1`. | Required for mobile layout to work. |
| `src/app/layout.tsx:27` | body: `min-h-dvh bg-neutral-950 text-neutral-100 antialiased`. | dvh unit is the fold reference. |
| `src/app/page.tsx:99` | `<main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 p-6">` | **The employee column is capped at 448 px (max-w-md).** |
| `src/app/page.tsx:100-122` | Header row: title + role pill + sign-out. | Header is `flex items-baseline justify-between`. |
| `src/app/page.tsx:137-140` | `<footer id="privacy" className="mt-auto pt-8 …">` | Footer pinned to bottom of column by `mt-auto` on a flex column. |
| `src/app/page.tsx:152-174` | `ConsentGate` modal: `fixed inset-0 z-50 grid place-items-center bg-black/80 p-6` with inner `max-w-sm`. | Centered overlay, max-w-sm. |
| `src/app/page.tsx:335-349` | Site `<select>` (employee). | `rounded-md border … px-3 py-2 text-sm`. |
| `src/app/page.tsx:350-384` | 7 status pills in `role="radiogroup"`, each `role="radio"`, active has `aria-checked="true"`. | Pillar assertion surface. |
| `src/app/page.tsx:401-407` | CHECK IN button: `h-16 rounded-xl bg-emerald-500 …`. | **The single most important employee CTA.** |
| `src/app/page.tsx:410-417` | Outbox badge: `rounded-md bg-amber-500/10 px-3 py-2 text-xs` with `Sync now` button. | Conditional — assert only when visible. |
| `src/app/page.tsx:418-433` | "Recent" list (`<ul>` of `<li>`s with status + time). | Listed under the CTA. |
| `src/app/moderator/page.tsx:43` | `<main className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-8 p-6">` | Moderator column capped at 896 px. |
| `src/app/moderator/page.tsx:53-56` | `<section className="grid gap-6 md:grid-cols-2">` for ProvisionPanel + SitePanel. | **2-col switch at md (768 px).** |
| `src/app/moderator/page.tsx:67-113` | Employees table (6 cols). | |
| `src/app/moderator/page.tsx:115-184` | Audit log table (7 cols: Time/Employee/Site/Status/±m/Skew/Flags). | |
| `src/app/moderator/page.tsx:44` | `<KpiBanner />` — `grid-cols-2 sm:grid-cols-4` (`kpi-banner.tsx:21`). | **2 cols on mobile, 4 cols on sm+.** |
| `src/app/moderator/geofence-modal.tsx:130-137` | `fixed inset-0 z-[1000] grid place-items-center bg-black/70 p-4` + inner `w-full max-w-lg`. | Max width 512 px. |
| `src/app/change-password.tsx:93-117` | `ForcedPasswordChange` — `fixed inset-0 z-[100] grid place-items-center bg-black/90 p-6` + inner `w-full max-w-sm`. | Max width 384 px. |
| `src/app/sign-in.tsx:18` | `mx-auto flex w-full max-w-sm` — the sign-in card is capped at 384 px. | |
| `postcss.config.mjs:1-7` | Only `@tailwindcss/postcss` is loaded (no custom plugin, no autoprefixer needed). | |

---

## A. Mobile employee (`/`, viewport 375x812)

### A.1 Surface: the content column
- Container: viewport 375x812 (`isMobile: true`, `deviceScaleFactor: 2`).
- Expected: `main` has `max-w-md` (448 px) and `mx-auto`; the column is
  **centered with 0 left/right margin** when viewport ≤ 448 px, and the
  column has `p-6` (24 px) padding internally.
- Assert via `getBoundingClientRect`:
  - `document.querySelector('main').getBoundingClientRect().left === 0`
    (because 375 < 448 — column fills the viewport width).
  - `.right === 375`.
  - `.top === 0` (since `min-h-dvh`).
  - `.width === 375`.
- Assert via `getComputedStyle`:
  - `getComputedStyle(main).maxWidth === "448px"` (Tailwind's `max-w-md`).
  - `getComputedStyle(main).paddingLeft === "24px"` (`p-6`).
- NOT to test: the exact `min-height` in px (depends on content load order).

### A.2 Surface: header bar
- Source: `src/app/page.tsx:100-122`. Title "J-Pay" + role pill + "Sign out".
- Expected: `h1` is left-aligned within the column; "Sign out" is at the
  right edge of the column; the role pill is to the left of "Sign out".
- Assert:
  - `h1.getBoundingClientRect().left === 24` (padding-left of column).
  - `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim()==='Sign out').getBoundingClientRect().right === 375 - 24 === 351`.
  - `role pill (span).getBoundingClientRect().right` < `Sign out.left` (left-of).
- A11y: `h1` exists; "Sign out" button has accessible name "Sign out".
- NOT to test: the role-pill background color (decorative).

### A.3 Surface: the **7 status pills** (CRITICAL)
- Source: `src/app/page.tsx:350-384`. `role="radiogroup"`, 7 `role="radio"`
  buttons with `rounded-full border px-4 py-2 text-sm`. The active pill
  has `border-emerald-400 bg-emerald-500/10 text-emerald-300`.
- Expected on 375 viewport: pills wrap to **2 lines** (the source uses
  `flex flex-wrap gap-2`); each pill is a 44 px tap target (≥ 32 px ✓).
- Assert:
  - `getAttribute('role') === 'radiogroup'` on the container.
  - Exactly **7** child buttons with `role === 'radio'`.
  - Exactly **1** with `aria-checked === 'true'`.
  - For the active pill: `getBoundingClientRect().height >= 36` (44 px
    target).
  - For the row: the second-line pill's `top` > first-line pill's
    `bottom` (i.e. they actually wrap, not overlap).
  - Pill row's total `height` < `window.innerHeight` (no overflow at the
    status-pill layer; this is a soft check).
- A11y:
  - `tabindex="0"` on the active pill only, `-1` on the rest (roving
    tabindex).
  - ArrowLeft/Right change selection: simulate `page.keyboard.press` and
    re-read `aria-checked` (functional but also a layout/visibility
    invariant).
- NOT to test: exact wrap point pixel (depends on font load).

### A.4 Surface: **CHECK IN button** (CRITICAL — above the fold)
- Source: `src/app/page.tsx:401-407`. `h-16` (64 px) `rounded-xl
  bg-emerald-500 text-lg font-bold`.
- Expected:
  - Full content-column width (375 - 2*24 = 327 px).
  - `bottom` is **above the fold on 812 viewport** — so the user can tap
    it without scrolling. Concretely: the button's `getBoundingClientRect().bottom`
    should be ≤ ~750 on a 375x812 (allowing room for Recent list to begin
    and the privacy footer to live). The most robust assertion: button is
    in the top half (`bottom < 600`) **when Recent list is empty**;
    otherwise assert it is **above the Outbox/Recent group**.
  - Height: exactly 64 px.
- Assert:
  - `rect.height === 64` (Tailwind `h-16`).
  - `rect.width === 327` (375 - 48).
  - `rect.left === 24`, `rect.right === 351`.
  - `rect.top` is between the status-pill row's `bottom` and the outbox
    badge's `top` (when the badge is visible).
  - `rect.bottom` ≤ `window.innerHeight` (the entire button is visible
    on first paint).
  - `getComputedStyle(el).backgroundColor` resolves to a green
    (`rgb(16, 185, 129)` ≈ `#10b981` — `bg-emerald-500`).
- A11y: button text content is "CHECK IN" exactly; `disabled` is
  `false` when not busy.
- NOT to test: `busy` text "Logging…" — the source swaps the label but
  keeps the same button. Don't assert on the busy state.

### A.5 Surface: outbox badge ("N check-in(s) queued offline")
- Source: `src/app/page.tsx:410-417`. Conditional — only present when
  `count > 0`.
- Expected: appears between CHECK IN and Recent. `Sync now` is a link-
  styled button (underline). Badge is amber (`bg-amber-500/10`).
- Assert when present:
  - `rect.top` ≥ CHECK IN `rect.bottom`.
  - `rect.left === 24` (column-aligned).
  - `rect.width <= 327`.
  - The "Sync now" button is to the right of the count text (justify-between).
- A11y: text says "N check-in(s) queued offline" exactly (singular/plural
  must match `count`).
- NOT to test: width-vs-text-overflow — fragile to font load.

### A.6 Surface: Recent list
- Source: `src/app/page.tsx:418-433`. `<ul>` of up to 10 `<li>`s with
  status + timestamp + flags.
- Expected: lives below the CTA and outbox badge; does **not** overlap
  the outbox badge; the column scrolls if there are more than fits.
- Assert:
  - First row's `rect.top` ≥ outbox badge's `rect.bottom` (or ≥
    CHECK IN's `bottom` if no badge).
  - No two consecutive `<li>` rects overlap (helper: rectA.bottom ≤
    rectB.top for sorted list).
  - All `<li>` rects have `left === 24`.
  - Each row's `height < 60` (compact row).
- A11y: section is `<section>` with `<h2>Recent</h2>`.

### A.7 Surface: privacy footer
- Source: `src/app/page.tsx:137-140`. `<footer id="privacy"
  className="mt-auto pt-8 text-xs leading-relaxed text-neutral-600">`.
- Expected: pinned to the bottom of the flex column by `mt-auto`; lives
  **at the end** of the document flow, not floating in the middle.
- Assert:
  - `rect.bottom === window.innerHeight` (or close — the column is
    `min-h-dvh`).
  - `rect.top > Recent list's last row's bottom`.
  - `getComputedStyle(footer).marginTop` is not "0px" (i.e. `mt-auto`
    applied) — read computed margin top; expect auto, not 0.
  - Text contains "never continuous tracking" (R13 copy from
    `layout-assert.mjs:298`).
- NOT to test: line-wrap count.

### A.8 Surface: iPhone install hint
- Source: `src/app/page.tsx:123-127`. `isIos()`-conditional `<p>` with
  amber bg.
- Expected: dismissable only by viewport change (the PWA install prompt
  is a separate thing); on a non-iOS UA it must not render at all.
- Assert (UA `Mozilla/5.0 (iPhone...`):
  - `<p>` exists, contains "Add to Home Screen".
  - `rect.top` is below the header, above the status pills.
  - Does **not** cover the CHECK IN button.
- Assert (non-iOS UA):
  - No `<p>` with text "iPhone:" rendered.

### A.9 Surface: consent modal (ConsentGate)
- Source: `src/app/page.tsx:146-175`. `fixed inset-0 z-50 grid
  place-items-center bg-black/80 p-6` + inner `max-w-sm`.
- Expected: centered on viewport, only the inner card has the
  background, backdrop covers the page.
- Assert:
  - `dialog.getBoundingClientRect()`: `left >= 0`, `right <= 375`,
    `top >= 0`, `bottom <= 812`.
  - `Math.abs((rect.left + rect.right) / 2 - window.innerWidth / 2) < 2`
    (horizontal centering).
  - `Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2) < 2`
    (vertical centering).
  - `rect.width <= 384` (max-w-sm = 24rem).
  - `getComputedStyle(backdrop).zIndex >= 50`.
  - `getComputedStyle(backdrop).backgroundColor` is non-transparent
    (rgba black with 80% alpha).
  - A button "I understand" exists, has `rect.height >= 44` (tap target).
  - `document.activeElement === acceptButton` (focus management
    per `page.tsx:149`).
- A11y:
  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby="consent-title"`.
- NOT to test: ESC key (the ConsentGate does **not** implement
  Escape — see §D for which modals do).

### A.10 Surface: forced password change modal
- Source: `src/app/change-password.tsx:81-118`. `z-[100]`, `bg-black/90`,
  `p-6`, inner `max-w-sm`.
- Expected: same centering rules as A.9. z-index is **higher** than the
  consent gate (100 vs 50), so it should overlay the gate when both
  are open.
- Assert:
  - Same geometry as A.9.
  - First focusable element is the submit button (the source explicitly
    focuses `submitRef.current` on mount — `change-password.tsx:85`).
  - 3 password inputs visible, all `type="password"`.
  - Submit button disabled until `current` is non-empty AND `next.length >= 8`.
- A11y:
  - `role="dialog"`, `aria-modal="true"`, `aria-labelledby="forced-pw-title"`.
- NOT to test: whether the form actually submits — that's a behavior
  test, not alignment.

---

## B. Desktop moderator (`/moderator`, viewport 1280x800)

### B.1 Surface: content column
- Source: `src/app/moderator/page.tsx:43`. `mx-auto max-w-4xl p-6`.
- Expected: column is 896 px wide, centered in 1280 viewport (192 px
  gutter on each side).
- Assert:
  - `main.getBoundingClientRect().width === 896`.
  - `(rect.left + rect.right) / 2 === 640` (half of 1280).
  - `getComputedStyle(main).maxWidth === "896px"`.

### B.2 Surface: **KPI banner** (4 cards, equal width)
- Source: `src/app/moderator/kpi-banner.tsx:21`. `grid-cols-2
  sm:grid-cols-4`. Each card is a `<div>` with `rounded-lg border p-3`.
- Expected on 1280: **4 columns**. Each card width ≈
  `(896 - 2*24 - 3*12) / 4 = 200` px (24 px padding, 12 px gap-3).
- Assert:
  - `[aria-label="Key metrics"]` is a `display: grid` with 4 children.
  - Card 0 and card 1 are on the same row (`rect.top` equal), and card 2
    is below them.
  - `getComputedStyle(banner).gridTemplateColumns` has 4 tracks (split on
    whitespace, length === 4 on 1280).
  - All 4 cards have width within 2 px of each other.
  - Any auxiliary control is **inside** the same section (not floating
    to the right).
- A11y: `aria-label="Key metrics"`.
- NOT to test: exact px widths of cards (responsive).

### B.3 Surface: ProvisionPanel + SitePanel (the 2-col grid)
- Source: `src/app/moderator/page.tsx:53-56`. `<section className="grid
  gap-6 md:grid-cols-2">`.
- Expected: 2 columns at viewport ≥ 768 (md). 1280 is comfortably above.
- Assert:
  - `section.getComputedStyle().gridTemplateColumns` has 2 tracks.
  - ProvisionPanel `rect.left === 0` (relative to section), SitePanel
    `rect.left > ProvisionPanel rect.right`.
  - Both panels have the same `rect.height` (or at least, their tops
    are equal — they may have different content heights but should
    share `top`).
  - Inner `<h2>`s are uppercase via `uppercase` class.
- A11y: `<h2>` heading visible on each panel.
- NOT to test: that the inputs render before the submit button
  (layout order is structural, not visual).

### B.4 Surface: AssignPanel
- Source: `src/app/moderator/page.tsx:336-404`. Single-column with two
  `<select>`s and Assign/Remove buttons.
- Expected: lives **below** the 2-col grid; full width of the column;
  the two selects sit side by side (wrap if too narrow — `flex-wrap`).
- Assert:
  - `AssignPanel rect.top >= SitePanel rect.bottom` (no overlap).
  - `getComputedStyle(row).flexWrap === "wrap"`.
  - The Assign button is left of the Remove button (or visually
    next to them — flex-row).
- A11y: both `<select>`s have visible labels via `sr-only` spans.

### B.5 Surface: PayrollPanel
- Source: `src/app/payroll.tsx:55-163`. Rounded card with employee
  `<select>`, range buttons (7d/14d/28d), strategy `<select>`, Export
  button. Table renders only when an employee is chosen.
- Expected: stacked vertically; the strategy `<select>` and Export
  button only render when the user picks an employee.
- Assert:
  - `rect.top` > AssignPanel `rect.bottom`.
  - When unselected: only the employee select + 3 range buttons render;
    strategy/Export are absent.
  - When an employee is selected and a result is loaded: the table's
    `rect.left === 0` (full-column width) and `rect.width === 896 -
    2*16` (panel padding 16 px = `p-4`).
  - The Total row has `font-semibold` and a different border-top
    (`border-neutral-700`).
- A11y: pay strategy `<select>` has `aria-label="Pay strategy"`.

### B.6 Surface: ReviewPanel (shifts needing review)
- Source: `src/app/payroll.tsx:165-199`. `<section className="rounded-lg
  border … p-4">`.
- Expected: stacked below PayrollPanel; no overlap.
- Assert:
  - `rect.top` > PayrollPanel `rect.bottom` (or > the table's bottom
    within the panel if PayrollPanel contains the table).
  - Each row is `flex flex-wrap items-center justify-between`; reason
    badge is amber/red.
  - Recompute + Resolve buttons are at the right of each row.
- A11y: row reason has a rounded background — not the alignment
  concern; ignore.

### B.7 Surface: MessagesPanel (moderator variant)
- Source: `src/app/messages.tsx:68-136`. Broadcast input + per-message
  reply box.
- Expected: stacked below ReviewPanel; does not overlap.
- Assert:
  - `rect.top` > ReviewPanel `rect.bottom`.
  - Broadcast input + Broadcast button: input `flex-1`, button right.
  - Each message: sender bold, timestamp in `text-neutral-500`,
    reply input + Reply button on second row.
- A11y: `aria-live="polite"` status messages.

### B.8 Surface: Employees table
- Source: `src/app/moderator/page.tsx:67-113`. `<table className="w-full
  text-left text-xs">` with 6 columns.
- Expected: full column width; the wrapping `<div>` has
  `overflow-x-auto` so the table can scroll horizontally on narrow
  screens without breaking the page.
- Assert:
  - 6 `<th>` elements in document order: Name, Email, Sites, Status,
    Rate/h, (empty action cell).
  - `<thead>` has `bg-neutral-900 text-neutral-500`.
  - All `<th>` `text-transform: uppercase` (from parent `tracking-wide
    uppercase` class — assert via computed `text-transform === "uppercase"`
    only if the *table cell* carries the class; otherwise check that
    the *containing element* has it).
  - For each row, the action cell's right-edge buttons are right-aligned
    (`text-right` on the `<td>`).
  - Wrapping `<div>` has `overflow-x: auto`.
- A11y: `<table>` has no `<caption>` (gap to flag) and no `scope`
  attributes on `<th>` (gap to flag — see F.1).

### B.9 Surface: **Audit log table** (CRITICAL)
- Source: `src/app/moderator/page.tsx:115-184`. 7 columns: Time
  (client), Employee, Site, Status, ±m, Skew, Flags.
- Expected: row height is uniform; the geofence "map" button in the
  Flags cell does not wrap a row taller than its neighbors; the
  "x shift(s) need review" badge above the table wraps gracefully.
- Assert:
  - 7 `<th>` cells in the audit `<thead>` in this exact order:
    "Time (client)", "Employee", "Site", "Status", "±m", "Skew",
    "Flags" (`page.$$eval('th', ths => ths.map(t => t.textContent.trim())`).
  - All `<th>` `rect.top` are equal (same row).
  - Body rows: each `<tr>` has 7 `<td>` cells; their `rect.top`s are
    equal within a row.
  - Row heights: max row height in the body < 2× min row height (no
    one row dominates).
  - The "x shift(s) need review" `<span role="status">` (line 119) has
    `rect.top === ths[0].rect.top` (it sits on the same baseline as
    the heading, not below the table).
- A11y:
  - `role="status"` and `aria-live="polite"` on the badge.
- NOT to test: Skew cell colour (`text-amber-400` vs `text-neutral-500`)
  — purely visual, not alignment.

### B.10 Surface: GeofenceModal
- Source: `src/app/moderator/geofence-modal.tsx:30-172`. `fixed inset-0
  z-[1000] grid place-items-center bg-black/70 p-4` + inner
  `w-full max-w-lg`.
- Expected: centered, max 512 px wide; has its own focus trap and ESC
  handler; rest of page is inert (covered by the 70% black backdrop).
- Assert:
  - `dialog.rect.width <= 512`.
  - `Math.abs((rect.left + rect.right)/2 - 640) < 2` (centered on 1280).
  - `Math.abs((rect.top + rect.bottom)/2 - 400) < 2` (centered on 800).
  - `getComputedStyle(backdrop).zIndex === "1000"`.
  - `getComputedStyle(backdrop).backgroundColor` alpha = 0.7.
  - `document.activeElement` is either the Close button or a focusable
    descendant of the dialog.
  - 3 `<dt>/<dd>` pairs (Site / Geofence radius / GPS accuracy /
    Verdict = 4 pairs).
- ESC:
  - `await page.keyboard.press('Escape')` should close the modal
    (verify by re-querying `[role="dialog"][aria-label*="Geofence"]` —
    should be absent after a brief wait).
- A11y:
  - `role="dialog"`, `aria-modal="true"`, `aria-label="Geofence and
    audit detail"`.
  - Map container has `data-focus-skip="true"` and `tabIndex={-1}` —
    verify with `getAttribute('data-focus-skip') === 'true'` and
    `getAttribute('tabindex') === '-1'`.
  - The Close button has accessible name "Close".
- NOT to test: leaflet internals (map zoom, marker placement — covered
  in the existing e2e).

---

## D. Modal centering & focus

### D.1 Centering helper (all 3 modals)

All three modals use the same `grid place-items-center` pattern on the
backdrop and an inner `w-full max-w-{sm|lg}` card. Assert:

```js
const backdrop = await page.$('[role="dialog"]');
const card = await page.$('[role="dialog"] > *');  // inner card
// card sits inside the backdrop:
const cb = await card.boundingBox();
const bb = await backdrop.boundingBox();
assert(cb.x >= bb.x && cb.x + cb.width <= bb.x + bb.width,
  "card must be contained in backdrop");
assert(Math.abs((cb.x + cb.width/2) - (window.innerWidth/2)) < 2,
  "horizontally centered");
assert(Math.abs((cb.y + cb.height/2) - (window.innerHeight/2)) < 2,
  "vertically centered");
```

Per-modal max widths:

| Modal | Max width | Source |
|---|---|---|
| ConsentGate | `max-w-sm` (384 px) | `page.tsx:158` |
| ForcedPasswordChange | `max-w-sm` (384 px) | `change-password.tsx:99` |
| GeofenceModal | `max-w-lg` (512 px) | `geofence-modal.tsx:137` |

### D.2 First focusable receives focus

- ConsentGate: focuses the "I understand" button on mount
  (`page.tsx:147-150`).
- ForcedPasswordChange: focuses the submit button on mount
  (`change-password.tsx:83-86`).
- GeofenceModal: focuses the first focusable in the dialog
  (`geofence-modal.tsx:40-43`). Expected first focusable is the Close
  button (it's the first `button` in the dialog markup at line 143).

Assert: after open, `await page.evaluate(() => document.activeElement.tagName)`
returns BUTTON, and `document.activeElement` is a descendant of the
dialog (`dialog.contains(document.activeElement)`).

### D.3 ESC closes (only GeofenceModal)

- ConsentGate: **does NOT** handle Escape (`page.tsx:146-175` has no
  keydown listener). Click backdrop or "I understand".
- ForcedPasswordChange: **does NOT** handle Escape
  (`change-password.tsx:81-118` has no keydown listener).
- GeofenceModal: **does** handle Escape (`geofence-modal.tsx:54-58`).

Assert only for GeofenceModal:
- `await page.keyboard.press('Escape')`.
- Wait briefly, then assert
  `await page.$('[role="dialog"][aria-label*="Geofence"]') === null`.

### D.4 Backdrop click

None of the three modals have an explicit `onClick` on the backdrop to
close — all rely on the inner card's Close/Submit/I-understand button.
Assert: clicking the backdrop does NOT close the modal (otherwise the
test would flake — gesture-driven interactions should be opt-in for
modals with destructive actions).

---

## E. Text overflow

### E.1 Long employee names in the audit log

- Source: `src/app/moderator/page.tsx:142-180`. The Employee cell has
  `<td className="p-2">{l.employeeName}</td>` — no truncation class.
- Expected: long names wrap; the row's `height` grows; the cell does
  not overflow the table horizontally (the table is `w-full` inside an
  `overflow-x-auto` wrapper).
- Assert:
  - Seed a 60-character employee name in the test fixture (via a
    dedicated fixture).
  - The `<td>` `rect.width` equals the column width
    (table total width / 7, ±2 px).
  - The `<td>` `rect.height > 20` (wrapped to 2+ lines).
  - The wrapping `<div>` has `scrollWidth >= clientWidth` ONLY when
    the table is wider than the wrapper — i.e. the table may scroll,
    but the column should still allocate its share of the width.

### E.2 Long payroll day rows

- Source: `src/app/payroll.tsx:136-148`. Day, Minutes, Pay.
- Expected: minutes and pay are right-aligned; long pay values
  (e.g. `R 12 345.67`) should not push the table past the column
  width.
- Assert:
  - `<td class="p-2 text-right">` for Minutes has
    `getComputedStyle().textAlign === "right"`.
  - `<td class="p-2 text-right">` for Pay has the same.
  - Table `rect.width <= panel rect.width`.

### E.3 "x shift(s) need review" badge

- Source: `src/app/moderator/page.tsx:118-126`. Lives inside the
  Audit log `<h2>`. Has `rounded-full bg-red-500/20 px-2 py-0.5
  text-xs normal-case text-red-300`.
- Expected: the badge wraps to a new line if the heading is too
  narrow; the heading is `flex items-center gap-2` so the badge can
  drop below the text on narrow viewports.
- Assert:
  - Badge is **inside** the `<h2>` (`h2.contains(badge)`).
  - Badge `rect.left` ≥ `<h2>` text rect's `rect.left` (visually to
    the right of "Audit log (7 days)").
  - On 375 viewport (mobile moderator — not the canonical target, but
    a useful regression), the badge can sit below the heading text
    without overflowing the viewport.

### E.4 Long site names in ProvisionPanel "code" output

- Source: `src/app/moderator/page.tsx:245-257`. The code reveal has
  `Email:` and `ID code:` lines; the `copy` button is at the bottom.
- Expected: long emails wrap; copy button stays at the bottom.
- Assert:
  - Reveal block `display: block` (default), not flex.
  - Copy button `rect.bottom <= block.rect.bottom`.

---

## F. Color contrast (sanity, not full WCAG audit)

The repo uses these utility classes for non-critical text:
- `text-neutral-500` on `bg-neutral-950` ≈ 4.0:1 (fails WCAG AA for
  body text; passes for large text only).
- `text-neutral-600` on `bg-neutral-950` ≈ 2.6:1 (fails WCAG AA for
  body text).
- `text-neutral-400` on `bg-neutral-950` ≈ 7.0:1 (passes).

### F.1 Audit: where `text-neutral-500/600` is used

- `src/app/page.tsx:117` (`Sign out` link), `:137` (privacy footer),
  `:425` (recent list timestamp).
- `src/app/moderator/page.tsx:79`, `:87`, `:94`, `:135`, `:145`,
  `:149`, `:155` — most audit log table cells.
- `src/app/payroll.tsx:121` (the "X flagged shift(s) excluded" line).
- `src/app/messages.tsx:97` (timestamp).

Sanity assertion: collect `getComputedStyle(el).color` and
`getComputedStyle(el).backgroundColor` for every element with a
`text-neutral-500` or `text-neutral-600` class on a
`bg-neutral-950/900/800` ancestor, and confirm via a simple
`relativeLuminance` calc (in `page.evaluate`) that the ratio is
**strictly between 2.5 and 5.0** (the "intentionally low" band). This
catches regressions where someone bumps neutral-500 to neutral-400
and accidentally elevates its hierarchy.

### F.2 Required text uses high-contrast tokens

- The "CHECK IN" button is `text-emerald-950` on `bg-emerald-500`
  (≈ 7.0:1 ✓).
- The privacy footer is `text-neutral-600` (intentionally low — see
  F.1). Assert: footer `getComputedStyle().color` matches the
  `text-neutral-600` token, **and** the footer's parent is not
  `text-neutral-100` (i.e. it's truly a tertiary copy, not a primary
  message).
- The audit log's "geofence✗" and "travel!" flags are
  `text-red-400` on `bg-neutral-950` (≈ 5.5:1 ✓) — verify these
  are the only red text in the table, no accidental
  `text-red-300` (which would fail on bg-neutral-950).

### F.3 Skew cell colour toggle

- `src/app/moderator/page.tsx:149`. `text-amber-400` when skew
  > 30 s, else `text-neutral-500`.
- Assert: when the cell is amber, `color` is approximately
  `rgb(251, 191, 36)` (amber-400); when it's grey, it's
  approximately `rgb(115, 115, 115)` (neutral-500). Don't test the
  threshold — that's a logic test.

---

## G. Form input visibility

### G.1 Tap target height (≥ 32 px on mobile, ≥ 24 px on desktop)

Walk all `<input>`, `<select>`, `<button>` (not `disabled`):

- `el.getBoundingClientRect().height >= 32` when viewport < 768.
- `el.getBoundingClientRect().height >= 24` when viewport >= 768.
- `el.getBoundingClientRect().width >= 32` (so the element is tappable
  in both axes).

Known-good inputs (sanity):

| Element | Source | Expected height |
|---|---|---|
| Site `<select>` (employee) | `page.tsx:340` | `py-2` + line-height = ~36 px ✓ |
| Status pills (employee) | `page.tsx:375` | `py-2` + `text-sm` = ~36 px ✓ |
| CHECK IN | `page.tsx:404` | `h-16` = 64 px ✓ |
| Duration `<select>` | `page.tsx:391` | `py-2` ≈ 36 px ✓ |
| Message input (employee) | `messages.tsx:43` | `py-2` ≈ 36 px ✓ |
| Send button | `messages.tsx:52` | `py-2` ≈ 36 px ✓ |
| Provision inputs | `moderator/page.tsx:209` | `py-2` ≈ 36 px ✓ |
| Audit map button | `moderator/page.tsx:173` | `py-1 text-xs` ≈ 24 px (borderline) — **flag if < 28** |
| RateCell input | `moderator/page.tsx:447` | `w-16 py-0.5` ≈ 20 px ✗ (intentionally compact) — **gap to flag in §11** |

### G.2 `<select>` shows full text (no clipping)

For every `<select>` in the DOM:
- `el.options[i].text` is fully visible (assert via
  `el.scrollWidth <= el.clientWidth` for the rendered option label —
  not perfect because native `<option>` rendering varies, but
  the `<select>` itself should not be clipped by its parent).
- `el.getBoundingClientRect().width > 0` and the `<select>` does
  not have `overflow: hidden` directly on it.

### G.3 Every `<button>` has a label or aria-label

`page.evaluate` to walk every `<button>`:
- `el.textContent.trim() !== ""` **or** `el.getAttribute('aria-label')`
  is non-null.
- If the button has only an icon (e.g. the `✓` "saved" state in
  `RateCell` at `moderator/page.tsx:459`), it has an `aria-label`
  (verify: `aria-label="Rate saved for …"` per `moderator/page.tsx:456`).

### G.4 Disabled state is visually distinct

For every `button[disabled]` or `input[disabled]`:
- `getComputedStyle(el).opacity < 1` (Tailwind `disabled:opacity-50`).

### G.5 No off-screen form fields

For every `<input>`, `<select>`, `<textarea>`:
- `rect.right > 0` and `rect.left < window.innerWidth` — the field is
  not pushed off the viewport (the side-map picker's hidden inputs are
  exempt; this is for visible forms only).

---

## H. Helpers (for the follow-up test file)

### H.1 `rectsOverlap(a, b)`
```js
const rectsOverlap = (a, b) =>
  !(a.right <= b.left || a.left >= b.right ||
    a.bottom <= b.top || a.top >= b.bottom);
```
Used to assert "no overlap" between two rects.

### H.2 `centered(box, vw, vh, tolerance = 2)`
```js
const centered = (box, vw, vh, t = 2) =>
  Math.abs((box.x + box.width/2) - vw/2) <= t &&
  Math.abs((box.y + box.height/2) - vh/2) <= t;
```

### H.3 `relativeLuminance(rgb)` and `contrastRatio(fg, bg)`
Pure JS, computed inside `page.evaluate`:
```js
const rel = ([r,g,b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  return 0.2126*f(r) + 0.7152*f(g) + 0.0722*f(b);
};
const ratio = (fg, bg) => (Math.max(rel(fg), rel(bg)) + 0.05) /
                          (Math.min(rel(fg), rel(bg)) + 0.05);
```

### H.4 `readPx(el, prop)`
```js
const px = (el, prop) =>
  page.evaluate((sel, p) => {
    const e = document.querySelector(sel);
    return e ? parseFloat(getComputedStyle(e)[p]) : NaN;
  }, el, prop);
```

### H.5 `gridCols(el)`
```js
const gridCols = (el) =>
  page.evaluate((e) => {
    const t = getComputedStyle(e).gridTemplateColumns;
    return t.split(/\s+/).filter(Boolean).length;
  }, el);
```

### H.6 `allButtonsLabels()`
```js
const labels = await page.evaluate(() =>
  [...document.querySelectorAll('button, [role="button"]')]
    .map(b => ({
      text: b.textContent.trim().slice(0, 60),
      aria: b.getAttribute('aria-label'),
      w: b.getBoundingClientRect().width,
      h: b.getBoundingClientRect().height,
    })));
```

---

## I. What NOT to test (consolidated)

- **Exact pixel widths of decorative dots / padding rings** — fragile
  to font load and OS scrollbar width.
- **Leaflet map internals** (zoom, marker placement) — covered by
  `scripts/e2e-full.mjs` already.
- **Convex wire latency** (spinner → content transitions) — already
  covered by `waitForHydrated` in `tests-layout/layout-assert.mjs:84-92`.
- **Auth handshake timing** — same.
- **Live data values** (KPI numbers, log counts) — the existing
  `tests-layout/layout-assert.mjs:184-189` sentinel already catches
  "wrong app". KPI values are seeded by `kpi.summary` and change.
- **Hover/focus ring colours** — the project uses Tailwind defaults;
  no custom focus ring to test.
- **`min-h-dvh` fallback to `min-h-screen` in old browsers** — the
  dev server is Chrome-only for the e2e.
- **The exact z-index ordering of overlapping fixed elements** beyond
  what is contractually stated: ConsentGate `z-50` (`page.tsx:153`),
  ForcedPasswordChange `z-[100]` (`change-password.tsx:94`),
  GeofenceModal `z-[1000]` (`geofence-modal.tsx:130`). Assert the
  *named* contracts; do not assert "100 > 50 > 0" because the
  comparisons are obvious and the named contracts are what the
  authors wrote.
- **Pixel-perfect parity with Figma** — there is no Figma source of
  truth in the repo.
- **The `tracking-wide uppercase text-neutral-500` class on every
  `<th>`** — `text-transform: uppercase` is a computed style of the
  *parent* `<thead>`/`<h2>`, not the cell. Assert the *parent* has
  the class.
- **Exact viewport meta content beyond `width=device-width` and
  `initial-scale=1`** — `themeColor` is mobile-browser specific.

---

## J. Open questions / gaps to flag in §11 of the TRD

These are alignment-related issues the deliverable surfaced that the
follow-up test should *not silently pass over* — they should be either
fixed or noted in the test as a "known issue" expectation:

1. **The moderator audit log table has no `<caption>` and no `scope`
   attributes on `<th>`** — see `moderator/page.tsx:128-140`.
   A11y regression risk; flag.
2. **RateCell `<input>` is ~20 px tall** — `moderator/page.tsx:447`
   `w-16 py-0.5`. Below the 24 px desktop target and 32 px mobile
   target. Likely intentional (it's an inline edit cell) but the
   current tap-target assertion in G.1 will flag it. Decide policy.
3. **Audit log "map" button is `py-1 text-xs`** — `moderator/page.tsx:173`
   ≈ 24 px tall. Borderline; flag if < 28.
5. **None of the three modals close on backdrop click** — the
   design intent is unclear. The follow-up test should assert *current
   behaviour* (no close on backdrop click) and the team should
   confirm the intent.
6. **ConsentGate and ForcedPasswordChange do not implement ESC** — see
   D.3. Assert the current behaviour (ESC does not close) and confirm
   intent.
7. **The privacy footer uses `text-neutral-600` on `bg-neutral-950`**
   (≈ 2.6:1, fails WCAG AA). This is intentionally low-priority copy,
   but it's a contrast audit gap. The test in F.2 should flag it as
   "intentional" rather than "passing".
8. **The `overflow-x-auto` wrapper around the Employees table
   (`moderator/page.tsx:71`) and the Audit log (`moderator/page.tsx:128`)
   means the table can horizontally scroll on narrow viewports** — a
   7-column audit log on 375 px viewport will be unreadable. Not a
   test failure on 1280, but the mobile moderator case (uncommon but
   not unsupported) should be asserted as a known degraded layout
   (table renders, no element overflows the page).
9. **`Sign out` uses `text-neutral-500` underline** — `page.tsx:117`
   — low contrast (≈ 4.0:1). Same intent question as the privacy
   footer.
10. **The "x shift(s) need review" badge** sits inside an `<h2>` with
    `tracking-wide uppercase` — if the badge has uppercase too, the
    source's `normal-case` overrides it. Verify: source at
    `moderator/page.tsx:122` has `normal-case`. If the source
    regresses, the badge would shout. Assert: badge
    `getComputedStyle().textTransform === "none"`.

---

## K. Cross-cutting assertions (apply to multiple surfaces)

These don't fit one section but are worth surfacing:

- **All `fixed` elements use `inset-0`** — assert that no `fixed`
  element has a `left !== 0 || top !== 0` (so modals can't drift
  off-origin). Modal backdrops at `page.tsx:153`,
  `change-password.tsx:94`, `geofence-modal.tsx:130` are the only
  three.
- **No horizontal page scroll** — assert
  `document.documentElement.scrollWidth <= window.innerWidth` on
  every page at every tested viewport. (Specific exception: tables
  inside `overflow-x-auto` may have `scrollWidth > clientWidth`.)
- **`<main>` is the only `<main>` per page** — `document.querySelectorAll('main').length === 1`
  on every route. `layout-assert.mjs` doesn't assert this; the
  sign-in lock screen and the loading state both render a `<main>`,
  so this is a sequencing check (clear the loading state first).
- **No content wider than the column** — for every direct child of
  `<main>`, `rect.left >= 0 && rect.right <= window.innerWidth`
  (excluding the `overflow-x-auto` table wrappers).
- **`min-h-dvh` is set on `<body>` and `<main>`** — assert
  `getComputedStyle(body).minHeight` resolves to a non-zero value
  in px (the dvh unit evaluates to a pixel value at runtime).
- **Body background is `bg-neutral-950`** — assert via
  `getComputedStyle(body).backgroundColor` is approximately
  `rgb(10, 10, 10)`.

---

## L. Recommended test file structure

This is layout-only guidance for the follow-up task; not test code.

A single file, e.g. `tests-layout/display-alignment.mjs`, with:
1. Top-level `test.before`/`test.beforeEach` matching the existing
   `layout-assert.mjs` pattern (`tests-layout/layout-assert.mjs:30-68`).
2. `setViewport({ width: 375, height: 812, deviceScaleFactor: 2,
   isMobile: true, hasTouch: true })` per `describe` block for mobile.
3. `setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })`
   for desktop (already used in `layout-assert.mjs:42`).
4. A `setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 …)')` to
   trigger the iOS install hint (`page.tsx:123-127`).
5. For each section (A–G): one `test(...)` block per *sub-surface*
   (e.g. A.1 through A.10), so a failure points at one surface.
6. Take a screenshot in each section header to `user-review/` for
   the `autonomous-reporting-discipline` skill's evidence-collector.
7. The existing `waitForHydrated` helper (`layout-assert.mjs:84-92`)
   should be reused (or imported) to handle the cold-compile path.

---

## M. Spec coverage map

| Section | # sub-surfaces | # assertions (approx) |
|---|---|---|
| A. Mobile employee | 10 | ~55 |
| B. Desktop moderator | 10 | ~55 |
| D. Modals | 3 (shared) | ~20 |
| E. Text overflow | 4 | ~15 |
| F. Contrast | 3 | ~10 |
| G. Form inputs | 5 | ~25 |
| **Total** | **35** | **~180** |

At 5–15 lines per spec, this is ~500 lines of test body (plus ~100
lines of helpers), which fits the requested budget.
