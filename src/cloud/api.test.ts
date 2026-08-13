import { afterEach, describe, expect, it, vi } from "vitest";
import { createCloudApiClient } from "./api";

const config = {
  anonKey: "publishable-test-key",
  url: "https://example.supabase.co",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("deleteCurrentAccount", () => {
  it("uses the authenticated account deletion RPC", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            deleted_project_count: 2,
            reason: "ok",
            success: true,
            transferred_project_count: 1,
          },
        ]),
        { status: 200 },
      ),
    );

    const result = await createCloudApiClient(
      config,
      () => "authenticated-access-token",
    ).deleteCurrentAccount();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/rest/v1/rpc/delete_current_account",
      expect.objectContaining({
        body: JSON.stringify({ p_confirmation: "DELETE_MY_ACCOUNT" }),
        headers: expect.objectContaining({
          Authorization: "Bearer authenticated-access-token",
        }),
        method: "POST",
      }),
    );
    expect(result).toMatchObject({ success: true, reason: "ok" });
  });
});
