import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CloudAuthError,
  createCloudAuthClient,
  getCloudAuthErrorMessage,
} from "./auth";

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
    expect(session.authFlow).toBeUndefined();
    expect(session.refreshToken).toBe("refresh");
    expect(session.user).toEqual({
      displayName: "オーナー",
      email: "owner@example.com",
      id: "owner-id",
    });
  });

  it("marks password recovery callbacks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ email: "owner@example.com", id: "owner-id" }),
        { status: 200 },
      ),
    );

    const session = await createCloudAuthClient(config).createSessionFromRedirectUrl(
      "jp.tairetsu.maker://auth/callback#access_token=access&refresh_token=refresh&type=recovery",
    );

    expect(session.authFlow).toBe("recovery");
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

describe("account recovery operations", () => {
  it("requests a reset email with the app redirect URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await createCloudAuthClient(config).requestPasswordReset(
      "owner@example.com",
      "jp.tairetsu.maker://auth/callback",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.supabase.co/auth/v1/recover?redirect_to=jp.tairetsu.maker%3A%2F%2Fauth%2Fcallback",
      expect.objectContaining({
        body: JSON.stringify({ email: "owner@example.com" }),
        method: "POST",
      }),
    );
  });

  it("resends signup confirmation and updates the authenticated password", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    const auth = createCloudAuthClient(config);

    await auth.resendSignupConfirmation("owner@example.com");
    await auth.updatePassword("access-token", "new-password");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.supabase.co/auth/v1/resend",
      expect.objectContaining({
        body: JSON.stringify({ email: "owner@example.com", type: "signup" }),
        method: "POST",
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.supabase.co/auth/v1/user",
      expect.objectContaining({
        body: JSON.stringify({ password: "new-password" }),
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
        method: "PUT",
      }),
    );
  });
});

describe("getCloudAuthErrorMessage", () => {
  it("localizes common Supabase authentication errors", () => {
    expect(
      getCloudAuthErrorMessage(
        new CloudAuthError("Invalid login credentials", 400, {
          error_code: "invalid_credentials",
        }),
      ),
    ).toBe("メールアドレスまたはパスワードが正しくありません。");
    expect(
      getCloudAuthErrorMessage(
        new CloudAuthError("Email rate limit exceeded", 429, {
          error_code: "over_email_send_rate_limit",
        }),
      ),
    ).toContain("しばらく待って");
  });
});
