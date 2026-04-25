/**
 * Zero-config debug logger. Verbose output is gated by an env-or-localStorage
 * flag so production builds stay quiet by default.
 *
 * Enable in main:    DEBUG=ghst npm run dev
 * Enable in renderer: localStorage.setItem("ghst:debug", "1") then reload
 *
 * Errors and warnings always go through console directly — never gate them.
 */

function isEnabled(): boolean {
  // Renderer: check localStorage. Wrapped in try because `localStorage` can
  // throw in some sandboxed contexts.
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("ghst:debug")) {
      return true;
    }
  } catch {
    /* ignore */
  }
  // Main / Node: check env var. `process` is undefined in renderer.
  if (typeof process !== "undefined" && process.env) {
    const v = process.env.DEBUG ?? "";
    if (v === "*" || v.split(/[,\s]+/).includes("ghst")) return true;
  }
  return false;
}

const enabled = isEnabled();

export function debug(...args: unknown[]): void {
  if (enabled) console.log(...args);
}
