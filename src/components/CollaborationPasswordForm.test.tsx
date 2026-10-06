// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CollaborationPasswordForm from "./CollaborationPasswordForm";
import type { CollaborationUiService } from "../collaboration/uiService";
afterEach(cleanup);
it("validates, blocks consecutive submits and clears credentials on completion", async () => {
  let complete!: () => void;
  const changePassword = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const service = { changePassword, run: (action: () => Promise<void>) => action() } as unknown as CollaborationUiService;
  render(<CollaborationPasswordForm service={service} busy={false} cancel={vi.fn()} />);
  const fill = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), {target:{value}});
  const submit = () => fireEvent.submit(screen.getByRole("button",{name:"パスワードを変更する"}).closest("form")!);
  fill("現在のパスワード","old-pass"); fill("新しいパスワード","short"); fill("新しいパスワード（確認）","short"); submit(); expect(changePassword).not.toHaveBeenCalled();
  fill("新しいパスワード","new-pass"); fill("新しいパスワード（確認）","new-pass"); submit(); submit(); expect(changePassword).toHaveBeenCalledOnce();
  complete(); await waitFor(() => expect((screen.getByLabelText("現在のパスワード") as HTMLInputElement).value).toBe(""));
  expect((screen.getByLabelText("新しいパスワード") as HTMLInputElement).value).toBe(""); expect((screen.getByLabelText("新しいパスワード（確認）") as HTMLInputElement).value).toBe("");
});
