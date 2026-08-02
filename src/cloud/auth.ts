import type { CloudConfig } from "./config";

type SupabaseAuthUser = {
  email?: string;
  id: string;
  user_metadata?: {
    display_name?: unknown;
  };
};

type SupabaseAuthResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  user?: SupabaseAuthUser;
};

export type CloudAuthUser = {
  displayName?: string;
  email?: string;
  id: string;
};

export type CloudAuthSession = {
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  tokenType: string;
  user: CloudAuthUser;
};

export type CloudAuthErrorDetails = {
  error?: string;
  error_code?: string;
  msg?: string;
  message?: string;
};

export class CloudAuthError extends Error {
  readonly details: CloudAuthErrorDetails | null;
  readonly status: number;

  constructor(
    message: string,
    status: number,
    details: CloudAuthErrorDetails | null,
  ) {
    super(message);
    this.name = "CloudAuthError";
    this.details = details;
    this.status = status;
  }
}

const parseAuthSession = (response: SupabaseAuthResponse): CloudAuthSession => {
  if (!response.access_token || !response.refresh_token || !response.user?.id) {
    throw new CloudAuthError(
      "ログイン情報を取得できませんでした。",
      200,
      null,
    );
  }

  const expiresIn = response.expires_in ?? 3600;
  return {
    accessToken: response.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    refreshToken: response.refresh_token,
    tokenType: response.token_type ?? "bearer",
    user: {
      displayName:
        typeof response.user.user_metadata?.display_name === "string"
          ? response.user.user_metadata.display_name
          : undefined,
      email: response.user.email,
      id: response.user.id,
    },
  };
};

export const createCloudAuthClient = (config: CloudConfig) => {
  const request = async <TResult>(
    path: string,
    body: Record<string, unknown> | null,
    accessToken?: string,
  ): Promise<TResult> => {
    const response = await fetch(`${config.url}/auth/v1/${path}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken ?? config.anonKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      let details: CloudAuthErrorDetails | null = null;
      try {
        details = (await response.json()) as CloudAuthErrorDetails;
      } catch {
        details = null;
      }
      throw new CloudAuthError(
        details?.message ??
          details?.msg ??
          details?.error ??
          "クラウド認証に失敗しました。",
        response.status,
        details,
      );
    }

    return (await response.json()) as TResult;
  };

  return {
    createSessionFromRedirectUrl: async (
      redirectUrl: string,
    ): Promise<CloudAuthSession> => {
      const url = new URL(redirectUrl);
      const parameters = new URLSearchParams(
        url.hash.startsWith("#") ? url.hash.slice(1) : url.hash,
      );
      for (const [key, value] of url.searchParams.entries()) {
        if (!parameters.has(key)) {
          parameters.set(key, value);
        }
      }
      const authError = parameters.get("error_description") ?? parameters.get("error");
      if (authError) {
        throw new CloudAuthError(authError, 400, { message: authError });
      }
      const accessToken = parameters.get("access_token");
      const refreshToken = parameters.get("refresh_token");
      if (!accessToken || !refreshToken) {
        throw new CloudAuthError(
          "確認リンクからログイン情報を取得できませんでした。",
          400,
          null,
        );
      }
      const userResponse = await fetch(`${config.url}/auth/v1/user`, {
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${accessToken}`,
        },
      });
      if (!userResponse.ok) {
        throw new CloudAuthError(
          "確認済みアカウントの情報を取得できませんでした。",
          userResponse.status,
          null,
        );
      }
      return parseAuthSession({
        access_token: accessToken,
        expires_in: Number(parameters.get("expires_in") ?? 3600),
        refresh_token: refreshToken,
        token_type: parameters.get("token_type") ?? "bearer",
        user: (await userResponse.json()) as SupabaseAuthUser,
      });
    },

    refreshSession: async (refreshToken: string): Promise<CloudAuthSession> =>
      parseAuthSession(
        await request<SupabaseAuthResponse>(
          "token?grant_type=refresh_token",
          {
            refresh_token: refreshToken,
          },
        ),
      ),

    signInWithPassword: async (
      email: string,
      password: string,
    ): Promise<CloudAuthSession> =>
      parseAuthSession(
        await request<SupabaseAuthResponse>("token?grant_type=password", {
          email,
          password,
        }),
      ),

    signOut: async (accessToken: string): Promise<void> => {
      await request<Record<string, never>>("logout", null, accessToken);
    },

    signUpWithPassword: async (
      email: string,
      password: string,
      displayName: string,
      emailRedirectTo?: string,
    ): Promise<CloudAuthSession | null> => {
      const path = emailRedirectTo
        ? `signup?redirect_to=${encodeURIComponent(emailRedirectTo)}`
        : "signup";
      const response = await request<SupabaseAuthResponse>(path, {
        data: {
          display_name: displayName,
        },
        email,
        password,
      });

      if (!response.access_token) {
        return null;
      }
      return parseAuthSession(response);
    },
  };
};
