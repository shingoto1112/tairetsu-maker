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
  type?: string;
  user?: SupabaseAuthUser;
};

export type CloudAuthFlowType =
  | "email_change"
  | "invite"
  | "magiclink"
  | "recovery"
  | "signup";

export type CloudAuthUser = {
  displayName?: string;
  email?: string;
  id: string;
};

export type CloudAuthSession = {
  accessToken: string;
  authFlow?: CloudAuthFlowType;
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

const asCloudAuthFlowType = (
  value: string | null | undefined,
): CloudAuthFlowType | undefined =>
  value === "email_change" ||
  value === "invite" ||
  value === "magiclink" ||
  value === "recovery" ||
  value === "signup"
    ? value
    : undefined;

export const getCloudAuthErrorMessage = (error: unknown): string => {
  if (!(error instanceof CloudAuthError)) {
    return error instanceof Error ? error.message : "クラウド認証に失敗しました。";
  }

  const code = (error.details?.error_code ?? error.details?.error ?? "").toLowerCase();
  const message = error.message.toLowerCase();
  if (
    code.includes("invalid_credentials") ||
    message.includes("invalid login credentials")
  ) {
    return "メールアドレスまたはパスワードが正しくありません。";
  }
  if (code.includes("email_not_confirmed") || message.includes("email not confirmed")) {
    return "メールアドレスの確認が完了していません。確認メールをご確認ください。";
  }
  if (
    code.includes("user_already_exists") ||
    code.includes("email_exists") ||
    message.includes("already registered")
  ) {
    return "このメールアドレスはすでに登録されています。";
  }
  if (
    code.includes("over_email_send_rate_limit") ||
    code.includes("rate_limit") ||
    error.status === 429
  ) {
    return "メールの送信回数が上限に達しました。しばらく待ってから再度お試しください。";
  }
  if (code.includes("weak_password") || message.includes("password should be")) {
    return "パスワードは6文字以上で設定してください。";
  }
  if (code.includes("same_password") || message.includes("same password")) {
    return "現在とは異なるパスワードを設定してください。";
  }
  if (
    code.includes("otp_expired") ||
    code.includes("flow_state_expired") ||
    message.includes("link has expired") ||
    message.includes("otp expired")
  ) {
    return "確認リンクの有効期限が切れています。新しいメールを送信してください。";
  }
  if (
    code.includes("refresh_token") ||
    code.includes("session_not_found") ||
    (message.includes("session") && message.includes("expired"))
  ) {
    return "ログインの有効期限が切れました。もう一度ログインしてください。";
  }
  return error.message || "クラウド認証に失敗しました。";
};

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
    authFlow: asCloudAuthFlowType(response.type),
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
    method: "POST" | "PUT" = "POST",
  ): Promise<TResult> => {
    const response = await fetch(`${config.url}/auth/v1/${path}`, {
      body: body ? JSON.stringify(body) : undefined,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken ?? config.anonKey}`,
        "Content-Type": "application/json",
      },
      method,
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
        throw new CloudAuthError(authError, 400, {
          error: parameters.get("error") ?? undefined,
          error_code: parameters.get("error_code") ?? undefined,
          message: authError,
        });
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
        type: parameters.get("type") ?? undefined,
        user: (await userResponse.json()) as SupabaseAuthUser,
      });
    },

    requestPasswordReset: async (
      email: string,
      emailRedirectTo?: string,
    ): Promise<void> => {
      const path = emailRedirectTo
        ? `recover?redirect_to=${encodeURIComponent(emailRedirectTo)}`
        : "recover";
      await request<Record<string, never>>(path, { email });
    },

    resendSignupConfirmation: async (
      email: string,
      emailRedirectTo?: string,
    ): Promise<void> => {
      const path = emailRedirectTo
        ? `resend?redirect_to=${encodeURIComponent(emailRedirectTo)}`
        : "resend";
      await request<Record<string, never>>(path, {
        email,
        type: "signup",
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

    updatePassword: async (
      accessToken: string,
      password: string,
    ): Promise<void> => {
      await request<SupabaseAuthUser>(
        "user",
        { password },
        accessToken,
        "PUT",
      );
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
