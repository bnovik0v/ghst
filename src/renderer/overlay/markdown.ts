import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Config } from "dompurify";

// Synchronous renderer — never async, since we re-render on every stream chunk.
marked.use({ async: false, gfm: true, breaks: false });

// Force every rendered link to open externally and never share an opener with
// the Electron renderer window.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node instanceof Element && node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    "p", "br", "strong", "em", "code", "pre",
    "ul", "ol", "li",
    "h1", "h2", "h3", "h4",
    "blockquote", "hr",
    "a", "span",
  ],
  ALLOWED_ATTR: ["href", "title", "class", "target", "rel"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i,
};

export function renderMarkdown(src: string): string {
  if (!src) return "";
  const raw = marked.parse(src) as string;
  return DOMPurify.sanitize(raw, PURIFY_CONFIG);
}
