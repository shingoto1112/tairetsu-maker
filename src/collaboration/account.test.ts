// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createCollaborationAccountApi } from "./account";
import { CloudAuthError, type CloudAuthSession } from "../cloud/auth";
import { CollaborationUiService } from "./uiService";
import type { CollaborationUiOptions } from "./uiTypes";
import { clearCloudAuthSession, saveCloudAuthSession, readCloudAuthSession, waitCloudAuthPersistence, refreshOwnedCloudAuthSession, cloudAuthEpoch } from "../cloud/session";
const native = vi.hoisted(() => ({ write: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../platform/secureSession", () => ({ writeNativeSecureSession: native.write, clearNativeSecureSession: vi.fn().mockResolvedValue(undefined), readNativeSecureSession: vi.fn() }));
const config = { url: "http://127.0.0.1:9999", anonKey: "mock" };
const session = (id = "owner", token = "old"): CloudAuthSession => ({ accessToken: token, refreshToken: token, expiresAt: Date.now()+3600000, tokenType: "bearer", user: { id, email: "test@example.invalid" } });
beforeEach(async () => { native.write.mockResolvedValue(undefined); clearCloudAuthSession(); await waitCloudAuthPersistence(); saveCloudAuthSession(session()); await waitCloudAuthPersistence(); });
afterEach(() => vi.restoreAllMocks());
function setup() {
  const reauthenticate = vi.fn().mockResolvedValue(session("owner", "fresh")), updatePassword = vi.fn().mockResolvedValue(undefined);
  return { reauthenticate, updatePassword, api: createCollaborationAccountApi(config, { reauthenticate, updatePassword }) };
}
it.each([["short", "short"], ["new-pass", "different"], ["old-pass", "old-pass"]])("validates before authentication (%s)", async (next, confirmation) => {
  const { api, reauthenticate } = setup(); await expect(api.changePassword("old-pass", next, confirmation)).rejects.toThrow(); expect(reauthenticate).not.toHaveBeenCalled();
});
it("rejects guest and incorrect current password without updating", async () => {
  const { api, reauthenticate, updatePassword } = setup();
  reauthenticate.mockRejectedValue(new CloudAuthError("secret",400,{error_code:"invalid_credentials"}));
  await expect(api.changePassword("bad-pass","new-pass","new-pass")).rejects.toThrow("現在のパスワードが正しくありません。");
  saveCloudAuthSession({ ...session(), collaborationGuest: true } as CloudAuthSession);
  await expect(api.changePassword("old-pass","new-pass","new-pass")).rejects.toMatchObject({code:"PERMANENT_ACCOUNT_REQUIRED"}); expect(updatePassword).not.toHaveBeenCalled();
});
it.each(["switch", "same-account-login", "wrong-user"])("rejects reauthentication race: %s", async mode => {
  const { api, reauthenticate, updatePassword } = setup();
  reauthenticate.mockImplementation(async () => { if(mode !== "wrong-user") { clearCloudAuthSession(); saveCloudAuthSession(session(mode === "switch" ? "other" : "owner")); } return session(mode === "wrong-user" ? "other" : "owner"); });
  await expect(api.changePassword("old-pass","new-pass","new-pass")).rejects.toMatchObject({code:"ACCOUNT_CHANGED"}); expect(updatePassword).not.toHaveBeenCalled();
});
it("preserves identity epoch, saves fresh session and rejects late refresh even with same tokens", async () => {
  const { api, reauthenticate } = setup(); reauthenticate.mockResolvedValue(session()); const epoch = cloudAuthEpoch();
  let reply!: (value: CloudAuthSession) => void;
  const refreshing = refreshOwnedCloudAuthSession(session(), () => new Promise(resolve => { reply = resolve; }));
  await expect(api.changePassword("old-pass","new-pass","new-pass")).resolves.toEqual({persistenceFailed:false});
  reply(session("owner","late")); await expect(refreshing).rejects.toThrow();
  expect(readCloudAuthSession()?.accessToken).toBe("old"); expect(cloudAuthEpoch()).toBe(epoch);
});
it("reports successful change separately from native Keychain failure", async () => {
  const { api } = setup(); vi.spyOn(console,"warn").mockImplementation(() => {}); native.write.mockRejectedValueOnce(new Error("Keychain unavailable"));
  await expect(api.changePassword("old-pass","new-pass","new-pass")).resolves.toEqual({persistenceFailed:true}); expect(readCloudAuthSession()?.accessToken).toBe("fresh");
});
it.each(["reauth", "update"])("maps 429 safely at %s", async stage => {
  const { api, reauthenticate, updatePassword } = setup(); (stage === "reauth" ? reauthenticate : updatePassword).mockRejectedValue(new CloudAuthError("secret",429,null));
  await expect(api.changePassword("old-pass","new-pass","new-pass")).rejects.toThrow("試行回数が多いため、しばらく待ってから再試行してください。");
});
it("distinguishes offline reauth and lost update response", async () => {
  const { api, reauthenticate, updatePassword } = setup(); reauthenticate.mockRejectedValueOnce(new TypeError("secret"));
  await expect(api.changePassword("old-pass","new-pass","new-pass")).rejects.toThrow("本人確認を完了できませんでした");
  updatePassword.mockRejectedValueOnce(new TypeError("secret")); await expect(api.changePassword("old-pass","new-pass","new-pass")).rejects.toThrow("変更結果を確認できません");
});
it("does not save into a switched account after update", async () => {
  const { api, updatePassword } = setup(); updatePassword.mockImplementation(async () => saveCloudAuthSession(session("other")));
  await expect(api.changePassword("old-pass","new-pass","new-pass")).rejects.toMatchObject({code:"ACCOUNT_CHANGED"}); expect(readCloudAuthSession()?.user.id).toBe("other");
});
it("UI service keeps the active shared editor and pending outbox untouched", async () => {
  const pending = [{ id:"pending-edit", bytes:new Uint8Array([1,2,3]) }], editor = { project:{title:"未送信の編集"} };
  const active = { editor, pending }, repository = vi.fn(), open=vi.fn(), transform=vi.fn();
  const options={config,active:()=>active,repository,open,transform} as unknown as CollaborationUiOptions;
  const service=new CollaborationUiService(()=>options);
  vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({access_token:"fresh",refresh_token:"fresh",user:{id:"owner",email:"test@example.invalid"}})}).mockResolvedValueOnce({ok:true,json:async()=>({id:"owner"})}));
  try {
    await service.changePassword("old-pass","new-pass","new-pass");
    expect(options.active()).toBe(active);expect(active.editor).toBe(editor);expect(active.pending).toBe(pending);expect(pending[0].bytes).toEqual(new Uint8Array([1,2,3]));
    expect(repository).not.toHaveBeenCalled();expect(open).not.toHaveBeenCalled();expect(transform).not.toHaveBeenCalled();expect(service.getSnapshot().notice).toBe("パスワードを変更しました。");
    expect(JSON.stringify(service.getSnapshot())).not.toMatch(/old-pass|new-pass/);
  } finally {vi.unstubAllGlobals();}
});
