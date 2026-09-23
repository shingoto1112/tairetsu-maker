import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_LINKS } from "./publicLinks";

describe("public app information links", () => {
  it("uses stable public HTTPS URLs", () => {
    expect(PUBLIC_LINKS).toEqual({
      privacy: "https://tairetsu-maker.vercel.app/privacy.html",
      support: "https://tairetsu-maker.vercel.app/support.html",
      terms: "https://tairetsu-maker.vercel.app/terms.html",
    });
  });

  it.each(["privacy.html", "terms.html", "support.html"])(
    "ships %s with links to every public information page",
    (fileName) => {
      const html = readFileSync(resolve(process.cwd(), "public", fileName), "utf8");
      expect(html).toContain('href="/privacy.html"');
      expect(html).toContain('href="/terms.html"');
      expect(html).toContain('href="/support.html"');
      expect(html).toContain('lang="ja"');
    },
  );

  it("documents account deletion and no tracking", () => {
    const privacy = readFileSync(
      resolve(process.cwd(), "public", "privacy.html"),
      "utf8",
    );
    expect(privacy).toContain("アカウントを削除");
    expect(privacy).toContain("広告目的のトラッキング");
    expect(privacy).toContain('id="data-controls"');
  });

  it("provides a support address without requiring a GitHub account", () => {
    const support = readFileSync(resolve(process.cwd(), "public", "support.html"), "utf8");
    expect(support).toContain('href="mailto:tairetsu.maker@gmail.com"');
    expect(support).toContain(">tairetsu.maker@gmail.com</a>");
    expect(support).not.toContain("issues/new");
  });
});
