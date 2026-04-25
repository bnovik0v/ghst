export type SessionLine = { ts: number; text: string };

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function formatFilenameStamp(ts: number): string {
  const d = new Date(ts);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `_${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`
  );
}

export function transcriptFilename(ts: number): string {
  return `ghst-${formatFilenameStamp(ts)}.txt`;
}

export function formatHeader(ts: number): string {
  const d = new Date(ts);
  return `ghst transcript — ${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${formatClock(ts)}`;
}

/**
 * Plain-text body: header, blank line, then `[HH:MM:SS] text` per line, with
 * a trailing newline. Designed to be diff-friendly and grep-friendly.
 */
export function formatTranscriptBody(startedAt: number, lines: SessionLine[]): string {
  return (
    `${formatHeader(startedAt)}\n\n` +
    lines.map((l) => `[${formatClock(l.ts)}] ${l.text}`).join("\n") +
    "\n"
  );
}
