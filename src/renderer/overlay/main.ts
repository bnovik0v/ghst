import type { IPCFromWorker } from "../../core/types.js";

const bridge = window.overlayBridge;

const pod = document.querySelector<HTMLDivElement>(".pod")!;
const sig = document.getElementById("toggle")!;
const statusLabel = document.getElementById("statusLabel") as HTMLSpanElement;
const scroll = document.getElementById("lines") as HTMLDivElement;
const hint = document.getElementById("hint") as HTMLDivElement;
const liveBar = document.getElementById("liveBar") as HTMLDivElement;
const liveCommittedEl = document.getElementById("liveCommitted") as HTMLSpanElement;
const liveTentativeEl = document.getElementById("liveTentative") as HTMLSpanElement;
const jumpDown = document.getElementById("jumpDown") as HTMLButtonElement;
const cardsEl = document.getElementById("cards") as HTMLDivElement;
const slotPrev = document.getElementById("slotPrev") as HTMLDivElement;
const slotCurrent = document.getElementById("slotCurrent") as HTMLDivElement;

const MAX_MESSAGES = 500;

type Message = { text: string; ts: number };
const messages: Message[] = [];
let state: "idle" | "listening" | "error" = "idle";
let lastError: string | undefined;

// ─── hint ────────────────────────────────────────────────────────────────────
function updateHint(): void {
  if (messages.length > 0) {
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

// ─── history (append-only, never rebuilt on live updates) ───────────────────
function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function appendMessage(msg: Message): void {
  messages.push(msg);
  if (messages.length > MAX_MESSAGES) {
    messages.shift();
    const firstMsgEl = scroll.querySelector(".message");
    firstMsgEl?.remove();
  }
  hint.hidden = true;

  const row = document.createElement("div");
  row.className = "message";
  const ts = document.createElement("span");
  ts.className = "message__ts";
  ts.textContent = formatTime(msg.ts);
  const text = document.createElement("span");
  text.className = "message__text";
  text.textContent = msg.text;
  row.appendChild(ts);
  row.appendChild(text);
  scroll.appendChild(row);
  scrollToBottom();
}

function clearMessages(): void {
  messages.length = 0;
  scroll.querySelectorAll(".message").forEach((el) => el.remove());
  updateHint();
}

// ─── scroll ─────────────────────────────────────────────────────────────────
// Always pin to bottom on new content — user asked for always-scroll behavior.
function scrollToBottom(): void {
  scroll.scrollTop = scroll.scrollHeight;
}

jumpDown.addEventListener("click", scrollToBottom);

// ─── live bar (stable DOM, word-level diff on tentative tail) ───────────────
/**
 * Diff-update the tentative span's word children. Any word that is unchanged
 * keeps its exact DOM node — the browser has nothing to repaint. Only
 * trailing words that actually changed are removed / re-added. This is what
 * stops the live row from flickering every tick.
 */
function updateTentativeWords(text: string): void {
  const nextWords = text.split(/\s+/).filter(Boolean);
  const nodes = Array.from(liveTentativeEl.children) as HTMLSpanElement[];

  let keep = 0;
  while (keep < nextWords.length && keep < nodes.length) {
    if (nodes[keep].dataset.word === nextWords[keep]) keep++;
    else break;
  }
  for (let i = nodes.length - 1; i >= keep; i--) nodes[i].remove();
  for (let i = keep; i < nextWords.length; i++) {
    const w = document.createElement("span");
    w.className = "word";
    w.dataset.word = nextWords[i];
    // Leading space on every word so joiner-spacing is consistent regardless
    // of surrounding committed text.
    w.textContent = (i === 0 && !liveCommittedEl.textContent ? "" : " ") + nextWords[i];
    liveTentativeEl.appendChild(w);
  }
}

function updateLive(committed: string, tentative: string): void {
  if (!committed && !tentative) {
    liveBar.hidden = true;
    liveCommittedEl.textContent = "";
    liveTentativeEl.replaceChildren();
    return;
  }
  liveBar.hidden = false;
  if (liveCommittedEl.textContent !== committed) {
    liveCommittedEl.textContent = committed;
  }
  updateTentativeWords(tentative);
  scrollToBottom();
}

function clearLive(): void {
  liveBar.hidden = true;
  liveCommittedEl.textContent = "";
  liveTentativeEl.replaceChildren();
}

// ─── wiring ─────────────────────────────────────────────────────────────────
function toggleListen(): void {
  if (state === "listening") bridge.send({ kind: "stop" });
  else bridge.send({ kind: "start" });
}

function clearAll(): void {
  clearMessages();
  clearLive();
  clearCards();
  // Also wipe the worker's transcript history + in-flight state so the
  // copilot context doesn't still see stale lines after a visual clear.
  bridge.send({ kind: "clear-context" });
}

function setState(next: typeof state, error?: string): void {
  state = next;
  lastError = error;
  pod.dataset.state = next;
  statusLabel.textContent =
    next === "listening" ? "rec" : next === "error" ? "err" : "idle";
  updateHint();
}

sig.addEventListener("click", toggleListen);

document.querySelectorAll<HTMLButtonElement>(".key").forEach((btn) => {
  btn.addEventListener("click", () => {
    const act = btn.dataset.act;
    if (act === "toggle-listen") toggleListen();
    else if (act === "clear") clearAll();
    else if (act === "hide") bridge.command?.({ kind: "hide" });
    else if (act === "ask") bridge.send({ kind: "copilot:trigger" });
    else if (act === "settings") openSettings();
  });
});

// ─── settings modal ─────────────────────────────────────────────────────────
const settingsEl = document.getElementById("settings") as HTMLDivElement;
const settingsKey = document.getElementById("settingsKey") as HTMLInputElement;
const settingsMsg = document.getElementById("settingsMsg") as HTMLDivElement;
const settingsSave = document.getElementById("settingsSave") as HTMLButtonElement;
const settingsCancel = document.getElementById("settingsCancel") as HTMLButtonElement;
const settingsClear = document.getElementById("settingsClear") as HTMLButtonElement;
const settingsTranscriptEnabled = document.getElementById("settingsTranscriptEnabled") as HTMLInputElement;
const settingsTranscriptDir = document.getElementById("settingsTranscriptDir") as HTMLInputElement;
const settingsTranscriptBrowse = document.getElementById("settingsTranscriptBrowse") as HTMLButtonElement;
const settingsTranscriptOpen = document.getElementById("settingsTranscriptOpen") as HTMLAnchorElement;
const settingsTranscriptDefault = document.getElementById("settingsTranscriptDefault") as HTMLAnchorElement;
const settingsPersona = document.getElementById("settingsPersona") as HTMLTextAreaElement;
const settingsPersonaCount = document.getElementById("settingsPersonaCount") as HTMLSpanElement;

function setSettingsMsg(text: string, kind: "ok" | "err" = "err"): void {
  if (!text) {
    settingsMsg.hidden = true;
    settingsMsg.textContent = "";
    return;
  }
  settingsMsg.hidden = false;
  settingsMsg.dataset.kind = kind;
  settingsMsg.textContent = text;
}

async function openSettings(): Promise<void> {
  setSettingsMsg("");
  settingsKey.value = "";
  const has = await bridge.hasGroqKey();
  settingsKey.placeholder = has ? "•••••••••• (saved — leave blank to keep)" : "gsk_…";
  const ts = await bridge.getTranscriptSettings();
  settingsTranscriptEnabled.checked = ts.enabled;
  settingsTranscriptDir.value = ts.dir;
  const persona = await bridge.getPersona();
  settingsPersona.value = persona;
  updatePersonaCount();
  settingsEl.hidden = false;
  settingsKey.focus();
}

function updatePersonaCount(): void {
  settingsPersonaCount.textContent = String(settingsPersona.value.length);
}

function closeSettings(): void {
  settingsEl.hidden = true;
}

settingsCancel.addEventListener("click", closeSettings);
settingsEl.addEventListener("click", (e) => {
  if (e.target === settingsEl) closeSettings();
});

settingsSave.addEventListener("click", async () => {
  const v = settingsKey.value.trim();
  // Always persist transcript settings.
  const tsRes = await bridge.setTranscriptSettings({
    enabled: settingsTranscriptEnabled.checked,
    dir: settingsTranscriptDir.value.trim(),
  });
  if (!tsRes.ok) {
    setSettingsMsg(tsRes.error, "err");
    return;
  }
  const personaRes = await bridge.setPersona(settingsPersona.value);
  if (!personaRes.ok) {
    setSettingsMsg(personaRes.error, "err");
    return;
  }
  if (v) {
    const res = await bridge.setGroqKey(v);
    if (!res.ok) {
      setSettingsMsg(res.error, "err");
      return;
    }
  }
  setSettingsMsg("Saved.", "ok");
  setTimeout(closeSettings, 600);
});

settingsTranscriptBrowse.addEventListener("click", async () => {
  const res = await bridge.pickTranscriptDir();
  if (res.ok) settingsTranscriptDir.value = res.dir;
});

settingsTranscriptOpen.addEventListener("click", async (e) => {
  e.preventDefault();
  // Save current path first so reveal opens the folder the user sees.
  await bridge.setTranscriptSettings({ dir: settingsTranscriptDir.value.trim() });
  const res = await bridge.revealTranscriptDir();
  if (!res.ok) setSettingsMsg(res.error, "err");
});

settingsTranscriptDefault.addEventListener("click", async (e) => {
  e.preventDefault();
  settingsTranscriptDir.value = await bridge.defaultTranscriptDir();
});

settingsClear.addEventListener("click", async () => {
  await bridge.clearGroqKey();
  settingsKey.value = "";
  setSettingsMsg("Key removed.", "ok");
});

settingsKey.addEventListener("keydown", (e) => {
  if (e.key === "Enter") settingsSave.click();
  else if (e.key === "Escape") closeSettings();
});

settingsPersona.addEventListener("input", updatePersonaCount);

// ─── cards (copilot EOT replies) ────────────────────────────────────────────
let currentCard: HTMLDivElement | null = null;
let prevCard: HTMLDivElement | null = null;

function formatHMS(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function makeCardEl(id: string, ts: number): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "card card--current card--streaming";
  el.dataset.cardId = id;

  const meta = document.createElement("div");
  meta.className = "card__meta";
  const tsSpan = document.createElement("span");
  tsSpan.className = "card__ts";
  tsSpan.textContent = formatHMS(ts);
  const statusSpan = document.createElement("span");
  statusSpan.className = "card__status";
  statusSpan.textContent = "streaming";
  meta.appendChild(tsSpan);
  meta.appendChild(statusSpan);

  const text = document.createElement("div");
  text.className = "card__text";

  el.appendChild(meta);
  el.appendChild(text);
  attachCardDismiss(el);
  return el;
}

/**
 * Click-to-dismiss with selection guard: if the pointer traveled more than
 * a few pixels between mousedown and mouseup, assume the user is selecting
 * text to copy and skip dismissal. Also skip if there's a live selection.
 */
function attachCardDismiss(el: HTMLDivElement): void {
  let down: { x: number; y: number } | null = null;
  el.addEventListener("mousedown", (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener("mouseup", (e) => {
    if (!down) return;
    const dx = Math.abs(e.clientX - down.x);
    const dy = Math.abs(e.clientY - down.y);
    down = null;
    if (dx > 4 || dy > 4) return;
    if (window.getSelection()?.toString()) return;
    dismissCard(el);
  });
}

function dismissCard(el: HTMLDivElement): void {
  const id = el.dataset.cardId;
  if (id) bridge.send({ kind: "card:dismiss", id });
  el.classList.add("card--dismissing");
  setTimeout(() => {
    el.remove();
    if (el === currentCard) currentCard = null;
    if (el === prevCard) prevCard = null;
    refreshCardsVisibility();
  }, 180);
}

function refreshCardsVisibility(): void {
  cardsEl.hidden = !currentCard && !prevCard;
}

function onCardStart(id: string, ts: number): void {
  // Rotate: previous is discarded, current becomes previous, new becomes current.
  if (prevCard) {
    prevCard.remove();
    prevCard = null;
  }
  if (currentCard) {
    currentCard.classList.remove("card--current", "card--streaming");
    currentCard.classList.add("card--prev");
    slotPrev.replaceChildren(currentCard);
    prevCard = currentCard;
  }
  currentCard = makeCardEl(id, ts);
  slotCurrent.replaceChildren(currentCard);
  cardsEl.hidden = false;
}

function onCardDelta(id: string, delta: string): void {
  if (!currentCard || currentCard.dataset.cardId !== id) return;
  const text = currentCard.querySelector<HTMLDivElement>(".card__text");
  if (!text) return;
  text.textContent = (text.textContent ?? "") + delta;
  text.scrollTop = text.scrollHeight;
}

function onCardDone(id: string): void {
  if (!currentCard || currentCard.dataset.cardId !== id) return;
  currentCard.classList.remove("card--streaming");
}

function onCardError(id: string, msg: string): void {
  if (!currentCard || currentCard.dataset.cardId !== id) return;
  currentCard.classList.remove("card--streaming");
  currentCard.classList.add("card--error");
  const text = currentCard.querySelector<HTMLDivElement>(".card__text");
  if (text) text.textContent = `copilot error: ${msg}`;
}

function clearCards(): void {
  prevCard?.remove();
  currentCard?.remove();
  prevCard = null;
  currentCard = null;
  slotPrev.replaceChildren();
  slotCurrent.replaceChildren();
  cardsEl.hidden = true;
}

bridge.onEvent((msg: IPCFromWorker) => {
  if (msg.kind === "transcript") {
    appendMessage({ text: msg.line.text, ts: msg.line.receivedAt });
    clearLive();
  } else if (msg.kind === "live") {
    updateLive(msg.committed, msg.tentative);
  } else if (msg.kind === "status") {
    setState(msg.status, msg.error);
    if (msg.status === "idle") clearCards();
  } else if (msg.kind === "card:start") {
    onCardStart(msg.id, msg.ts);
  } else if (msg.kind === "card:delta") {
    onCardDelta(msg.id, msg.delta);
  } else if (msg.kind === "card:done") {
    onCardDone(msg.id);
  } else if (msg.kind === "card:error") {
    onCardError(msg.id, msg.msg);
  }
});

bridge.onCommand?.((cmd) => {
  if (cmd.kind === "clear") clearAll();
  else if (cmd.kind === "toggle-listen") toggleListen();
  else if (cmd.kind === "open-settings") void openSettings();
});

updateHint();
