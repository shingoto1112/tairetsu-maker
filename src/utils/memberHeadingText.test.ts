// @vitest-environment jsdom
import { expect, it } from "vitest";
import { setMemberHeadingText } from "./memberHeadingText";
it("keeps the count whole with the same full text used by the layout", () => {
  const el = document.createElement("div");
  for (const text of ["赤組（18人）", "赤組（続き）（146人）"]) {
    setMemberHeadingText(el, text);
    expect(el.textContent).toBe(text);
    expect(el.querySelector("span")?.style.whiteSpace).toBe("nowrap");
    expect(el.querySelector("span")?.textContent).toMatch(/^（\d+人）$/);
  }
});
