/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorPaletteInput } from "./ColorPaletteInput";

describe("ColorPaletteInput", () => {
  afterEach(() => cleanup());

  it("renders above panel stacking contexts and allows the final swatch to be selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <div style={{ overflow: "hidden" }}>
        <ColorPaletteInput
          label="グループカラー"
          value="#0f766e"
          onChange={onChange}
        />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: "グループカラーを選ぶ" }));

    const palette = screen.getByRole("listbox", { name: "グループカラー" });
    expect(palette.parentElement).toBe(document.body);
    expect(screen.getAllByRole("option")).toHaveLength(104);

    await user.click(
      screen.getByRole("option", { name: "グループカラー: 8段目 13列目" }),
    );

    expect(onChange).toHaveBeenCalledWith("#f4bce3");
    expect(screen.queryByRole("listbox", { name: "グループカラー" })).toBeNull();
  });
});
