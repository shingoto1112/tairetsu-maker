import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudAuthError, createCloudAuthClient } from "./auth";

const config = {
  anonKey: "publishable-test-key",
  url: "https://example.supabase.co",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSessionFromRedirectUrl", () => {
  it("validates an iOS auth callback and creates a session", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          email: "owner@example.com",
          id: "owner-id",
          user_metadata: { display_name: "オーナー" },
        }),
        { status: 200 },
      ),
    );

    const session = await createCloudAuthClient(config).createSessionFromRedirectUrl(
      "jp.tairetsu.maker://auth/callback#access_token=access&refresh_token=refresh&expires_in=3600&token_type=bearer",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access" }),
      }),
    );
    expect(session.accessToken).toBe("access");
    expect(session.refreshToken).toBe("refresh");
    expect(session.user).toEqual({
      displayName: "オーナー",
      email: "owner@example.com",
      id: "owner-id",
    });
  });

  it("rejects callbacks that do not contain tokens", async () => {
    await expect(
      createCloudAuthClient(config).createSessionFromRedirectUrl(
        "jp.tairetsu.maker://auth/callback",
      ),
    ).rejects.toBeInstanceOf(CloudAuthError);
  });

  it("surfaces an auth error returned in the callback", async () => {
    await expect(
      createCloudAuthClient(config).createSessionFromRedirectUrl(
        "jp.tairetsu.maker://auth/callback?error_description=Link%20expired",
      ),
    ).rejects.toMatchObject({ message: "Link expired", status: 400 });
  });
});
