# Overlay UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the overlay layout so long copilot suggestions get the room they need without obscuring transcript context, and redesign the settings panel to match the pod's glass aesthetic with no inner scroll and an inline "remove key" action.

**Architecture:** Renderer-only refactor (`src/renderer/overlay/*`). The chat history block (`.chat`, `.chat__scroll`, `.chat__live`, `.chat__jump`) is replaced by a thin top-anchored transcript ribbon plus a repositioned self-voice line. The cards row becomes a 2:1 grid (current : previous) with markdown rendering and a soft-cap-then-scroll height policy. The settings modal is rebuilt as a two-column glass panel with an inline-action field component. No changes to main, worker, core, or IPC.

**Tech Stack:** TypeScript, vanilla DOM, electron-vite, Vitest. New runtime deps: `marked` (markdown → HTML), `dompurify` (sanitize HTML before insertion).

---

## File structure

| Path | Action | Responsibility |
| --- | --- | --- |
| `src/renderer/overlay/index.html` | Modify | New transcript-ribbon + self-line + cards layout; new settings panel markup. |
| `src/renderer/overlay/style.css` | Modify | New ribbon/self-line/cards-grid rules; full settings panel rebuild. Old `.chat*` rules removed. |
| `src/renderer/overlay/main.ts` | Modify | Replace history/live-bar code paths with ribbon updater; render markdown in card bodies; rewire settings panel events (inline remove action, switch toggle, dim-when-off folder controls, shortcuts list). |
| `src/renderer/overlay/markdown.ts` | Create | Pure helper: `renderMarkdown(src: string): string` returns sanitized HTML. Unit-tested. |
| `src/main/index.ts` | Modify | Bump overlay default width from 820 to 1080 (and `minWidth` to 720). |
| `tests/markdown.test.ts` | Create | Unit tests for the markdown helper. |
| `package.json` | Modify | Add `marked` and `dompurify` runtime deps; add `@types/dompurify` dev dep. |

The plan touches **only** these files. Main/worker/core stay untouched.

---

## Task 1: Add markdown rendering helper (TDD)

**Files:**
- Create: `src/renderer/overlay/markdown.ts`
- Test: `tests/markdown.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add deps**

Run:
```bash
npm install marked dompurify
npm install -D @types/dompurify
```

Expected: `package.json` gains `"marked": "^x"` and `"dompurify": "^x"` under `dependencies`, `"@types/dompurify"` under `devDependencies`. (`marked` ships its own types; `dompurify` does not.)

- [ ] **Step 2: Write the failing test**

Create `tests/markdown.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderMarkdown } from "../src/renderer/overlay/markdown";

describe("renderMarkdown", () => {
  it("renders paragraphs and inline code", () => {
    const out = renderMarkdown("Hello `world`.");
    expect(out).toContain("<p>");
    expect(out).toContain("<code>world</code>");
  });

  it("renders bullet lists", () => {
    const out = renderMarkdown("- one\n- two\n");
    expect(out).toMatch(/<ul>[\s\S]*<li>one<\/li>[\s\S]*<li>two<\/li>[\s\S]*<\/ul>/);
  });

  it("renders fenced code blocks", () => {
    const out = renderMarkdown("```js\nconst x = 1;\n```\n");
    expect(out).toContain("<pre>");
    expect(out).toContain("<code");
    expect(out).toContain("const x = 1;");
  });

  it("strips disallowed html (script tag)", () => {
    const out = renderMarkdown('hi <script>alert(1)</script>');
    expect(out).not.toContain("<script");
    expect(out).not.toContain("alert(1)");
  });

  it("preserves links but strips javascript: hrefs", () => {
    const safe = renderMarkdown("[ok](https://example.com)");
    expect(safe).toContain('href="https://example.com"');

    const evil = renderMarkdown("[bad](javascript:alert(1))");
    expect(evil).not.toContain("javascript:");
  });

  it("returns empty string for empty input", () => {
    expect(renderMarkdown("").trim()).toBe("");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/markdown.test.ts`
Expected: FAIL — module `../src/renderer/overlay/markdown` not found.

- [ ] **Step 4: Implement the helper**

Create `src/renderer/overlay/markdown.ts`:

```ts
import { marked } from "marked";
import DOMPurify from "dompurify";

// Synchronous renderer — never async, since we re-render on every stream chunk.
marked.use({ async: false, gfm: true, breaks: false });

const PURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "code", "pre",
    "ul", "ol", "li",
    "h1", "h2", "h3", "h4",
    "blockquote", "hr",
    "a", "span",
  ],
  ALLOWED_ATTR: ["href", "title", "class"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
};

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const raw = marked.parse(src) as string;
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/markdown.test.ts`
Expected: PASS — all six tests green.

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/overlay/markdown.ts tests/markdown.test.ts
git commit -m "feat(overlay): markdown rendering helper for card bodies"
```

---

## Task 2: Restructure overlay markup (HTML)

**Files:**
- Modify: `src/renderer/overlay/index.html`

This task replaces the `<div class="chat">…</div>` block (which contains `.chat__scroll`, `.chat__live`, `.chat__jump`, plus the `#hint` and `#sessionContext` children) with a transcript ribbon plus a wrapper that still hosts `#hint` and `#sessionContext`. The `#selfLine` element moves to live directly under the ribbon. The `#cards` block stays but its inner row will be re-styled in Task 3 — the markup is identical.

The settings markup is rebuilt entirely.

- [ ] **Step 1: Replace the chat block + selfLine block**

In `src/renderer/overlay/index.html`, replace lines 128–152 (the `<div class="chat" id="chat">…</div>` block, and the `<div id="selfLine" class="self-line" hidden></div>` line) with:

```html
      <div class="ribbon" id="ribbon" role="log" aria-live="polite" hidden>
        <span class="ribbon__committed" id="liveCommitted"></span>
        <span class="ribbon__tentative" id="liveTentative"></span>
      </div>

      <div id="selfLine" class="self-line" hidden></div>

      <div class="stage" id="stage">
        <div class="stream__hint" id="hint">
          Press <kbd>⌃</kbd><kbd>⇧</kbd><kbd>␣</kbd> to listen &nbsp;·&nbsp;
          whatever your speakers play, <em>ghst</em> hears.
        </div>
        <textarea
          class="session-context"
          id="sessionContext"
          spellcheck="false"
          maxlength="4000"
          placeholder="What's this session? (e.g., 'Stripe SRE interview, focus on incident response')"
          hidden
        ></textarea>
      </div>
```

This:
- removes `.chat`, `.chat__scroll`, `.chat__live`, `.chat__jump`,
- adds `.ribbon` (re-using the existing `#liveCommitted` / `#liveTentative` IDs so `main.ts` keeps working until Task 4),
- moves `#selfLine` to its new position right under the ribbon,
- keeps `#hint` and `#sessionContext` inside a neutral `.stage` wrapper (they need somewhere to live in the layout).

- [ ] **Step 2: Replace the settings panel**

Replace lines 57–126 (the entire `<div class="settings" id="settings"...>…</div>` block) with:

```html
      <div class="settings" id="settings" hidden role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
        <div class="settings__panel">
          <div class="settings__head">
            <span class="settings__title" id="settingsTitle">settings</span>
            <span class="settings__brand">ghst</span>
          </div>

          <div class="settings__grid">
            <div class="settings__col">
              <div class="settings__group">
                <div class="settings__lab">
                  <span>Groq API key</span>
                  <span class="settings__hint-inline" id="settingsKeyHint">stored in OS keyring</span>
                </div>
                <div class="settings__field" id="settingsKeyField">
                  <input
                    class="settings__input"
                    id="settingsKey"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    placeholder="gsk_…"
                  />
                  <span class="settings__field-status" id="settingsKeyStatus" aria-hidden="true"></span>
                  <button class="settings__field-act" id="settingsClear" type="button">remove</button>
                </div>
                <div class="settings__links">
                  Get one at <a href="#" id="settingsKeyUrl">console.groq.com/keys</a>
                </div>
                <div class="settings__msg" id="settingsMsg" hidden></div>
              </div>

              <div class="settings__group">
                <div class="settings__lab">
                  <span>About you</span>
                  <span class="settings__hint-inline"><span id="settingsPersonaCount">0</span> / 4000</span>
                </div>
                <div class="settings__field settings__field--textarea">
                  <textarea
                    class="settings__input settings__textarea"
                    id="settingsPersona"
                    spellcheck="false"
                    maxlength="4000"
                    placeholder="Name, role, current company, key projects, strong opinions, anything you want the copilot to ground answers in. Plain prose works best."
                  ></textarea>
                </div>
              </div>
            </div>

            <div class="settings__col">
              <div class="settings__group">
                <div class="settings__lab"><span>Transcript capture</span></div>
                <label class="settings__switch" id="settingsTranscriptSwitch">
                  <input id="settingsTranscriptEnabled" type="checkbox" />
                  <span class="settings__switch-track" aria-hidden="true"></span>
                  <span class="settings__switch-label">Save <code>.txt</code> on stop</span>
                </label>
                <div class="settings__field" id="settingsTranscriptDirField">
                  <input
                    class="settings__input"
                    id="settingsTranscriptDir"
                    type="text"
                    autocomplete="off"
                    spellcheck="false"
                  />
                  <button class="settings__field-act" id="settingsTranscriptBrowse" type="button">browse…</button>
                </div>
                <div class="settings__links">
                  <a href="#" id="settingsTranscriptOpen">Open folder</a>
                  ·
                  <a href="#" id="settingsTranscriptDefault">Reset to default</a>
                </div>
              </div>

              <div class="settings__group">
                <div class="settings__lab"><span>Shortcuts</span></div>
                <ul class="settings__shortcuts">
                  <li><span>Toggle overlay</span><kbd>⌃⇧L</kbd></li>
                  <li><span>Toggle listen</span><kbd>⌃⇧␣</kbd></li>
                  <li><span>Clear</span><kbd>⌃⇧C</kbd></li>
                  <li><span>Trigger copilot</span><kbd>⌃⇧⏎</kbd></li>
                </ul>
              </div>
            </div>
          </div>

          <div class="settings__foot">
            <button class="settings__btn settings__btn--ghost" id="settingsCancel" type="button">Close</button>
            <button class="settings__btn settings__btn--primary" id="settingsSave" type="button">Save</button>
          </div>
        </div>
      </div>
```

Note: every ID that `main.ts` already references is preserved (`settingsKey`, `settingsClear`, `settingsCancel`, `settingsSave`, `settingsTranscriptEnabled`, `settingsTranscriptDir`, `settingsTranscriptBrowse`, `settingsTranscriptOpen`, `settingsTranscriptDefault`, `settingsPersona`, `settingsPersonaCount`, `settingsMsg`). New IDs (`settingsKeyField`, `settingsKeyStatus`, `settingsKeyHint`) are introduced for the inline-action visuals wired in Task 4.

- [ ] **Step 3: Verify build still loads the page without runtime errors**

Run: `npm run dev` in one terminal. Open the overlay window. The pod should render. The transcript ribbon and stage will look unstyled until Task 3, but no JS errors should appear in the worker DevTools console (`DEBUG=ghst npm run dev` to see them).

Expected: no `Cannot read properties of null (reading 'addEventListener')` or similar — every `getElementById` in `main.ts` still resolves.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/overlay/index.html
git commit -m "refactor(overlay): replace chat block with ribbon + stage; rebuild settings markup"
```

---

## Task 3: New overlay CSS (ribbon, self-line, cards grid, settings)

**Files:**
- Modify: `src/renderer/overlay/style.css`

This is the biggest CSS change. It removes the `.chat*` rules, adds a new ribbon block, restyles `.self-line` to sit cleanly under the ribbon, changes the `.cards` grid from `1fr 1fr` to `2fr 1fr` with the soft-cap height policy, adds markdown styles inside `.card__text`, and rebuilds the entire `.settings*` block.

- [ ] **Step 1: Remove the obsolete chat rules**

Delete from `src/renderer/overlay/style.css`:

- the `.chat` block (currently around lines 273–291)
- `.chat__scroll` and its `:first-child`, scrollbar pseudo-element rules (lines 293–329)
- `.message`, `.message__ts`, `.message__text`, `@keyframes line-in` (lines 331–365)
- `.chat__live` and its `.committed` / `.tentative` / `.tentative .word` / `@keyframes word-in` rules (lines 367–403)
- `.chat__jump` and `@keyframes jump-in` (lines 405–433)
- the `#root { justify-content: flex-start; gap: 10px; }` re-declaration around line 480 (it duplicates the rule at line 40)

Keep `.stream__hint` and the `kbd` styling underneath it.

- [ ] **Step 2: Add ribbon + stage styles**

After the `.stream__hint` block, add:

```css
/* ————————————————————————— RIBBON (live transcript) ————————————————————————— */

.ribbon {
  width: 100%;
  max-width: 1040px;
  flex-shrink: 0;
  padding: 10px 16px 12px;
  border: 1px solid rgba(255, 77, 94, 0.12);
  border-radius: 14px;
  background: rgba(255, 77, 94, 0.04);
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.5;
  color: var(--ink);
  overflow-wrap: break-word;
  word-wrap: break-word;
  max-height: calc(1.5em * 3 + 22px);
  overflow: hidden;
}
.ribbon[hidden] { display: none; }

.ribbon__committed { color: var(--ink); }
.ribbon__tentative { color: var(--ink-ghost); font-style: italic; }
.ribbon__tentative .word { display: inline; animation: word-in 220ms ease both; }

@keyframes word-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}

/* ————————————————————————— STAGE (hint + session context) ————————————————————————— */

.stage {
  width: 100%;
  max-width: 1040px;
  flex-shrink: 0;
  padding: 0 2px;
}
```

- [ ] **Step 3: Restyle the self-line**

Replace the existing `.self-line` and `.self-line::before` rules (around lines 885–907) with:

```css
/* ————————————————————————— SELF LINE (running "You: …") ————————————————————————— */

.self-line {
  width: 100%;
  max-width: 1040px;
  flex-shrink: 0;
  padding: 6px 16px;
  background: transparent;
  border: 0;
  border-radius: 0;
  font-family: var(--font-body);
  font-style: italic;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.self-line[hidden] { display: none; }

.self-line::before {
  content: "You: ";
  font-style: normal;
  font-weight: 600;
  color: var(--ink-ghost);
  letter-spacing: 0.02em;
}
```

- [ ] **Step 4: Update the cards grid + soft-cap height**

Locate the `.cards { … grid-template-columns: 1fr 1fr; … }` rule (around line 567). Replace the entire `.cards`, `.card__slot`, `.card`, `.card:hover`, `.card--prev`, `.card--current`, `.card--dismissing`, `.card--error`, `.card__meta`, `.card__status`, `.card__text` rules and their scrollbar pseudo-elements with:

```css
/* ————————————————————————— CARDS (EOT copilot replies) ————————————————————————— */

.cards {
  width: 100%;
  max-width: 1040px;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 10px;
  padding: 0 2px;
}
.cards[hidden] { display: none; }

.card__slot {
  min-height: 96px;
  display: flex;
}
.card__slot:empty { visibility: hidden; }

.card {
  flex: 1 1 auto;
  background: rgba(8, 9, 12, 0.66);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  backdrop-filter: blur(18px) saturate(140%);
  -webkit-backdrop-filter: blur(18px) saturate(140%);
  padding: 12px 14px;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink);
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
  -webkit-app-region: no-drag;
  max-height: min(70vh, 560px);
  overflow: hidden;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    transform 220ms cubic-bezier(0.2, 0.9, 0.2, 1),
    opacity 200ms ease;
  animation: card-in 280ms cubic-bezier(0.2, 0.9, 0.2, 1) both;
}

.card:hover {
  background: rgba(14, 16, 20, 0.78);
  border-color: rgba(255, 255, 255, 0.12);
}

.card--prev { opacity: 0.55; }
.card--prev:hover { opacity: 1; }

.card--current {
  border-color: rgba(255, 77, 94, 0.22);
  box-shadow:
    0 0 0 1px rgba(255, 77, 94, 0.08) inset,
    0 10px 26px -8px rgba(255, 77, 94, 0.18);
}

.card--dismissing {
  opacity: 0 !important;
  transform: translateY(4px);
  pointer-events: none;
}

.card--error { border-color: rgba(255, 177, 74, 0.32); }
.card--error .card__text { color: var(--accent-warm); }

.card__meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-ghost);
}

.card__status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--accent);
  opacity: 0;
}
.card--streaming .card__status { opacity: 1; }
.card--streaming .card__status::before {
  content: "";
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: var(--accent);
  animation: card-pulse 1.1s ease-in-out infinite;
}

.card__text {
  flex: 1 1 auto;
  min-height: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--ink);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  scrollbar-width: thin;
}
.card__text::-webkit-scrollbar { width: 6px; }
.card__text::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
}

/* Markdown blocks inside cards */
.card__text > :first-child { margin-top: 0; }
.card__text > :last-child { margin-bottom: 0; }
.card__text p { margin: 0 0 8px; }
.card__text ul, .card__text ol { margin: 4px 0 8px; padding-left: 20px; }
.card__text li { margin: 2px 0; }
.card__text h3, .card__text h4 {
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 14px;
  margin: 6px 0 4px;
}
.card__text code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  padding: 1px 5px;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 4px;
}
.card__text pre {
  margin: 6px 0;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.45);
  border-radius: 6px;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.5;
}
.card__text pre code {
  background: transparent;
  padding: 0;
  font-size: inherit;
}
.card__text a {
  color: var(--accent);
  text-decoration: none;
  border-bottom: 1px solid rgba(255, 77, 94, 0.3);
}
.card__text a:hover { border-bottom-color: var(--accent); }
.card__text strong { font-weight: 600; }
```

(Keep the existing `@keyframes card-in` and `@keyframes card-pulse` already in the file — do not duplicate them.)

- [ ] **Step 5: Rebuild the settings block**

Locate the `/* ─── settings modal ───────…*/` section (currently lines 707 onward). Delete everything from that comment down to (but not including) the `.session-context` rule. Replace with:

```css
/* ————————————————————————— SETTINGS PANEL ————————————————————————— */

.settings {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 9999;
}
.settings[hidden] { display: none; }

.settings__panel {
  width: min(720px, 94vw);
  background: rgba(8, 9, 12, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 20px;
  color: var(--ink);
  font-family: var(--font-body);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  box-shadow:
    0 1px 0 0 var(--edge-hi) inset,
    0 30px 80px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}

.settings__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 18px 22px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.settings__title {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 400;
  font-variation-settings: "SOFT" 70, "WONK" 1, "opsz" 18;
  font-size: 20px;
  letter-spacing: -0.01em;
  color: var(--ink);
}
.settings__brand {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ink-dim);
}

.settings__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.settings__col {
  display: flex;
  flex-direction: column;
}
.settings__col + .settings__col {
  border-left: 1px solid rgba(255, 255, 255, 0.05);
}

.settings__group {
  padding: 16px 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.settings__group:last-child { border-bottom: 0; }

.settings__lab {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-dim);
  margin-bottom: 8px;
}
.settings__hint-inline {
  letter-spacing: 0;
  text-transform: none;
  font-family: var(--font-body);
  font-size: 11px;
  color: var(--ink-ghost);
}

.settings__field {
  display: flex;
  align-items: stretch;
  background: rgba(255, 255, 255, 0.035);
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 10px;
  overflow: hidden;
  transition: border-color 160ms ease;
}
.settings__field:focus-within { border-color: rgba(255, 77, 94, 0.45); }
.settings__field--textarea { display: block; }

.settings__input {
  flex: 1 1 auto;
  min-width: 0;
  background: transparent;
  border: 0;
  outline: 0;
  padding: 10px 12px;
  color: var(--ink);
  font-family: var(--font-mono);
  font-size: 12.5px;
}
.settings__textarea {
  width: 100%;
  resize: vertical;
  min-height: 96px;
  max-height: 220px;
  font-family: var(--font-body);
  font-size: 13px;
  line-height: 1.5;
}

.settings__field-status {
  display: flex;
  align-items: center;
  padding: 0 8px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.18);
}
.settings__field-status[data-state="set"] { color: #7ad79a; }
.settings__field-status[data-state="set"]::before { content: "●"; }

.settings__field-act {
  background: transparent;
  border: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.07);
  color: var(--ink-dim);
  padding: 0 12px;
  font-family: var(--font-body);
  font-size: 11px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 160ms ease, color 160ms ease;
}
.settings__field-act:hover {
  color: var(--accent);
  background: rgba(255, 77, 94, 0.06);
}

.settings__links {
  margin-top: 8px;
  font-size: 11px;
  color: var(--ink-ghost);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.settings__links a {
  color: var(--ink-dim);
  text-decoration: none;
  cursor: pointer;
}
.settings__links a:hover { color: var(--accent); }

.settings__msg {
  margin-top: 10px;
  font-size: 12px;
  color: var(--accent);
}
.settings__msg[data-kind="ok"] { color: #7ad79a; }

.settings__switch {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  user-select: none;
  margin-bottom: 10px;
}
.settings__switch input {
  position: absolute;
  opacity: 0;
  width: 0; height: 0;
  pointer-events: none;
}
.settings__switch-track {
  width: 34px;
  height: 20px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  position: relative;
  transition: background 160ms ease;
  flex-shrink: 0;
}
.settings__switch-track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--ink);
  transition: transform 160ms ease;
}
.settings__switch input:checked + .settings__switch-track {
  background: rgba(255, 77, 94, 0.55);
}
.settings__switch input:checked + .settings__switch-track::after {
  transform: translateX(14px);
}
.settings__switch-label { font-size: 13px; color: var(--ink); }
.settings__switch-label code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  background: rgba(0, 0, 0, 0.45);
  padding: 1px 5px;
  border-radius: 4px;
}

.settings__group[data-disabled="true"] .settings__field,
.settings__group[data-disabled="true"] .settings__links {
  opacity: 0.42;
  pointer-events: none;
}

.settings__shortcuts {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 12px;
  color: var(--ink-dim);
}
.settings__shortcuts li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
}
.settings__shortcuts li + li { border-top: 1px solid rgba(255, 255, 255, 0.04); }
.settings__shortcuts kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 4px;
  color: var(--ink);
}

.settings__foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.settings__btn {
  padding: 8px 14px;
  border-radius: 10px;
  border: 0;
  cursor: pointer;
  font-family: var(--font-body);
  font-size: 13px;
  font-weight: 500;
  transition: filter 120ms ease, background 120ms ease;
}
.settings__btn--primary {
  background: var(--accent);
  color: #15080a;
}
.settings__btn--primary:hover { filter: brightness(1.08); }
.settings__btn--ghost {
  background: transparent;
  color: var(--ink-dim);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.settings__btn--ghost:hover {
  color: var(--ink);
  border-color: rgba(255, 255, 255, 0.2);
}

@media (max-width: 720px) {
  .settings__grid { grid-template-columns: 1fr; }
  .settings__col + .settings__col { border-left: 0; border-top: 1px solid rgba(255, 255, 255, 0.05); }
}
```

- [ ] **Step 6: Sanity check the build**

Run: `npm run typecheck`
Expected: PASS (CSS doesn't typecheck but ensure nothing in main.ts now references stale classes that the linter catches via querySelector strings — this is mostly a smoke step; Task 4 owns the JS edits).

Run: `npm run dev` and open the overlay. Pod renders; transcript ribbon styled; self-line dim italic; cards grid is 2:1; settings panel opens with the new look. Some interactions (inline remove button, switch dim-when-off) won't fully work yet — Task 4 fixes that.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/overlay/style.css
git commit -m "style(overlay): ribbon, self-line, 2:1 cards, glass settings panel"
```

---

## Task 4: Wire renderer JS to the new layout

**Files:**
- Modify: `src/renderer/overlay/main.ts`

This task removes the now-orphan history/scroll/jump code, switches the live-bar updater to target the ribbon (functions keep working because the inner span IDs are preserved), wires the new settings interactions (inline remove button, switch dim-when-off, status indicator), and renders markdown into card bodies on each delta.

- [ ] **Step 1: Remove dead element references and dead code**

In `src/renderer/overlay/main.ts`, delete these lines/blocks:

- The `scroll`, `liveBar`, `jumpDown` constants near the top (currently lines 8, 10, 13) — they no longer exist.
- The `MAX_MESSAGES`, `Message` type, `messages` array (lines 19–22 and 32 area depending on edits).
- The `appendMessage`, `clearMessages`, `formatTime` functions (the entire history block, lines ~85–120).
- The `scrollToBottom` function and the `jumpDown.addEventListener("click", scrollToBottom)` line (lines 122–128).
- Any `scrollToBottom()` call in `updateLive` (line ~170).
- In `updateHint`, remove the `if (messages.length > 0) { hint.hidden = true; return; }` branch — there is no message history anymore; the hint hides only when the session-context textarea is showing (handled by `updateSessionContextVisibility`) or when the ribbon is active (the ribbon's presence is independent — keep the hint logic simple: visible when no ribbon content and not in session-context mode).

- [ ] **Step 2: Add a ribbon reference and adjust `updateLive` / `clearLive`**

Replace the `liveBar`, `liveCommittedEl`, `liveTentativeEl` block with:

```ts
const ribbon = document.getElementById("ribbon") as HTMLDivElement;
const liveCommittedEl = document.getElementById("liveCommitted") as HTMLSpanElement;
const liveTentativeEl = document.getElementById("liveTentative") as HTMLSpanElement;
```

In `updateLive`, replace the two `liveBar.hidden = …` lines with `ribbon.hidden = …`. The committed/tentative span updates and `updateTentativeWords` keep working unchanged.

In `clearLive`, replace `liveBar.hidden = true;` with `ribbon.hidden = true;`.

Remove the call to `scrollToBottom()` at the end of `updateLive`.

- [ ] **Step 3: Update `updateHint` for the new structure**

Replace the entire `updateHint` body with:

```ts
function updateHint(): void {
  if (sessionContextEl && !sessionContextEl.hidden) {
    hint.hidden = true;
    return;
  }
  hint.hidden = false;
  if (state === "error" && lastError) {
    hint.innerHTML = `<span class="error"></span>`;
    (hint.firstElementChild as HTMLElement).textContent = lastError;
  } else if (state === "listening") {
    hint.textContent = "Listening · system audio · tap again to stop.";
  } else {
    hint.innerHTML =
      'Press <kbd>⌃</kbd><kbd>⇧</kbd><kbd>␣</kbd> to listen &nbsp;·&nbsp; ' +
      'whatever your speakers play, <em>ghst</em> hears.';
  }
}
```

(The change is removing the `messages.length > 0` branch.)

- [ ] **Step 4: Update `clearAll`**

The function currently calls `clearMessages()`. Remove that call:

```ts
function clearAll(): void {
  clearLive();
  clearCards();
  updateSelfLine("");
  bridge.send({ kind: "clear-context" });
}
```

- [ ] **Step 5: Render markdown in card bodies**

Add an import at the top of `main.ts`:

```ts
import { renderMarkdown } from "./markdown";
```

Modify `onCardDelta` to accumulate the raw markdown source on the element and re-render on each delta:

```ts
function onCardDelta(id: string, delta: string): void {
  if (!currentCard || currentCard.dataset.cardId !== id) return;
  const text = currentCard.querySelector<HTMLDivElement>(".card__text");
  if (!text) return;
  const prev = currentCard.dataset.md ?? "";
  const next = prev + delta;
  currentCard.dataset.md = next;
  text.innerHTML = renderMarkdown(next);
  text.scrollTop = text.scrollHeight;
}
```

In `onCardError`, replace the `text.textContent = …` line with a plain text fallback (errors are not markdown):

```ts
function onCardError(id: string, msg: string): void {
  if (!currentCard || currentCard.dataset.cardId !== id) return;
  currentCard.classList.remove("card--streaming");
  currentCard.classList.add("card--error");
  const text = currentCard.querySelector<HTMLDivElement>(".card__text");
  if (text) {
    text.textContent = `copilot error: ${msg}`;
    delete currentCard.dataset.md;
  }
}
```

In `onCardStart`, after creating the new current card and before returning, ensure no stale `data-md` is present (it won't be, since `makeCardEl` returns a fresh element, but make it explicit):

```ts
// inside makeCardEl, after el.appendChild(text):
delete el.dataset.md;
```

(Or just leave `makeCardEl` alone — `dataset.md` is unset on a fresh element.)

- [ ] **Step 6: Wire the inline "remove" button + status indicator**

Add a constant near the other settings constants:

```ts
const settingsKeyStatus = document.getElementById("settingsKeyStatus") as HTMLSpanElement;
```

Modify `openSettings` to update the status indicator:

```ts
async function openSettings(): Promise<void> {
  setSettingsMsg("");
  settingsKey.value = "";
  const has = await bridge.hasGroqKey();
  settingsKey.placeholder = has ? "•••••••••• (saved — leave blank to keep)" : "gsk_…";
  settingsKeyStatus.dataset.state = has ? "set" : "unset";
  const ts = await bridge.getTranscriptSettings();
  settingsTranscriptEnabled.checked = ts.enabled;
  settingsTranscriptDir.value = ts.dir;
  applyTranscriptDimming();
  const persona = await bridge.getPersona();
  settingsPersona.value = persona;
  updatePersonaCount();
  settingsEl.hidden = false;
  settingsKey.focus();
}
```

Update the existing `settingsClear.addEventListener("click", …)` to also flip the status to unset:

```ts
settingsClear.addEventListener("click", async () => {
  await bridge.clearGroqKey();
  settingsKey.value = "";
  settingsKeyStatus.dataset.state = "unset";
  setSettingsMsg("Key removed.", "ok");
});
```

Update the success branch in the save handler so a new key flips the indicator to set:

```ts
if (v) {
  const res = await bridge.setGroqKey(v);
  if (!res.ok) {
    setSettingsMsg(res.error, "err");
    return;
  }
  settingsKeyStatus.dataset.state = "set";
}
```

- [ ] **Step 7: Wire the switch toggle's dim-when-off behaviour**

Add a helper near `updatePersonaCount`:

```ts
function applyTranscriptDimming(): void {
  const group = settingsTranscriptEnabled.closest<HTMLDivElement>(".settings__group");
  if (!group) return;
  group.dataset.disabled = settingsTranscriptEnabled.checked ? "false" : "true";
}
```

Wire the change event:

```ts
settingsTranscriptEnabled.addEventListener("change", applyTranscriptDimming);
```

(The CSS rule from Task 3 keys off `[data-disabled="true"]` to dim the field and links.)

- [ ] **Step 8: Wire the external "Get one at" link**

Add a handler so `console.groq.com/keys` opens externally rather than navigating the renderer:

```ts
const settingsKeyUrl = document.getElementById("settingsKeyUrl") as HTMLAnchorElement;
settingsKeyUrl.addEventListener("click", (e) => {
  e.preventDefault();
  bridge.command?.({ kind: "open-external", url: "https://console.groq.com/keys" });
});
```

If `IPCToOverlay` does not already include `open-external`, fall back to `window.open` — but keep it on a no-op preload bridge command if available. If neither path is wired, leave the existing plain text behaviour (no anchor click handler) and adjust the markup in Task 2 to render the URL as a non-clickable span. **Verify before implementing: open `src/preload/overlay.ts` and check.** If `command` doesn't accept `open-external`, drop this step's edit and instead change the markup in Task 2 line containing `<a href="#" id="settingsKeyUrl">…</a>` to `<span>console.groq.com/keys</span>` and remove the `settingsKeyUrl` constant.

- [ ] **Step 9: Run the test suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, typecheck clean.

- [ ] **Step 10: Manual smoke test**

Run: `npm run dev`. Confirm:

- Pod renders; clicking the EQ starts listening.
- While listening, the ribbon shows committed text in full ink and tentative words in italic dim.
- Speaking yourself populates the self-line as "You: …" right under the ribbon.
- Triggering copilot (Ctrl+Shift+Enter) produces a card with rendered markdown (paragraphs, lists, code blocks).
- A long answer fits within ~70vh; a very long answer scrolls inside the card.
- Settings: the API key field shows a green dot when a key is set, and "remove" inline clears it (dot goes dim). Toggle switches; folder field dims when off. Close + Save work. No inner scrollbar at default window size.

- [ ] **Step 11: Commit**

```bash
git add src/renderer/overlay/main.ts
git commit -m "feat(overlay): ribbon + markdown cards + inline remove + switch toggle"
```

---

## Task 5: Bump default overlay window width

**Files:**
- Modify: `src/main/index.ts:138-151`

The new layout's `max-width: 1040px` and the wider settings panel (`min(720px, 94vw)`) need a window wider than the current 820px default to look right out of the box.

- [ ] **Step 1: Update window dimensions**

In `src/main/index.ts`, change the `createOverlay` constants:

```ts
function createOverlay(): BrowserWindow {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const width = 1080;
  const height = 480;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round((workAreaSize.width - width) / 2),
    y: 40,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    minHeight: 200,
    minWidth: 720,
    hasShadow: false,
    focusable: true,
```

Only the values for `width`, `height`, and `minWidth` change (820→1080, 400→480, 480→720). Everything else is unchanged.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. The overlay should open at 1080×480, centered. Settings modal opens without horizontal overflow.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): widen overlay default window for new layout"
```

---

## Task 6: Final verification + housekeeping

**Files:** none modified beyond what's already committed.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new `tests/markdown.test.ts`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS for both `tsconfig.node.json` and `tsconfig.web.json`.

- [ ] **Step 3: Production build sanity check**

Run: `npm run build`
Expected: `out/` populated, no errors. The `vadAssetsPlugin` still runs, ONNX assets land in `out/renderer/<which>/vad/`.

- [ ] **Step 4: Manual end-to-end smoke**

Run: `npm run dev`. Verify each acceptance criterion from the spec:

- Long copilot reply (≥1500 chars with code blocks) renders with formatted markdown, fits within ~70vh, only scrolls when content exceeds the cap.
- Live transcript stays visible while a long answer is on screen.
- Previous card stays at full row height, opacity 0.55 default and 1.0 on hover.
- Self-running line shows "You: …" directly under the transcript ribbon.
- Settings modal opens at default size without showing a scrollbar.
- API key inline "remove" works and the status dot updates.
- Capture toggle visually switches; folder controls dim when off.
- All existing keyboard shortcuts still work (`⌃⇧L`, `⌃⇧␣`, `⌃⇧C`, `⌃⇧⏎`).

- [ ] **Step 5: No final commit needed** — verification only.

---

## Notes for the implementer

- **DRY the constants:** the `1040px` max-width recurs in `.ribbon`, `.self-line`, `.cards`, `.stage`. If you find yourself wanting a CSS variable, declare `--row-max: 1040px;` in `:root` and reference it in those four rules. Optional polish, not required.
- **Markdown streaming flicker:** rendering on every delta tends to cause visible repaint on large code blocks. If that becomes annoying in manual testing, debounce to `requestAnimationFrame` inside `onCardDelta`. Don't bother unless you can see it.
- **"You:" prefix:** stays as a CSS pseudo-element, matching what's in the codebase today. If a future spec wants the prefix translated/localized, that's a separate change.
- **Do not** add scroll-to-bottom logic to the ribbon. It's a soft-cap text block; older lines naturally fall out of view because the ribbon's `max-height` truncates and the underlying text node only ever holds the current committed string from the worker (the worker's `LocalAgreement` already drains older committed words).
