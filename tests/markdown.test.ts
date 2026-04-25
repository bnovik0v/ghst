// @vitest-environment jsdom
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
