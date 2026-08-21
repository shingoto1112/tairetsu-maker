import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createAppStoreConnectToken,
  findCertificatesCreatedSince,
  revokeCertificatesCreatedSince,
} from "./apple-signing-certificates.mjs";

const certificate = (id, overrides = {}) => ({
  attributes: {
    activated: true,
    certificateType: "DEVELOPMENT",
    displayName: "Apple Development: Created via API",
    name: "Created via API",
    platform: "IOS",
    ...overrides,
  },
  id,
  type: "certificates",
});

describe("App Store Connect signing certificate lifecycle", () => {
  it("creates a short-lived ES256 token", () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const token = createAppStoreConnectToken({
      issuerId: "issuer-id",
      keyId: "KEY123",
      nowSeconds: 1_000,
      privateKey: privateKey.export({ format: "pem", type: "pkcs8" }),
    });
    const [header, payload, signature] = token.split(".");

    expect(JSON.parse(Buffer.from(header, "base64url").toString("utf8"))).toEqual({
      alg: "ES256",
      kid: "KEY123",
      typ: "JWT",
    });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))).toEqual({
      aud: "appstoreconnect-v1",
      exp: 1_900,
      iat: 995,
      iss: "issuer-id",
    });
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
  });

  it("selects only new API-created development certificates", () => {
    const selected = findCertificatesCreatedSince(["old"], [
      certificate("old"),
      certificate("new"),
      certificate("manual", { displayName: "Developer Mac", name: "Developer Mac" }),
      certificate("distribution", { certificateType: "DISTRIBUTION" }),
    ]);

    expect(selected.map(({ id }) => id)).toEqual(["new"]);
  });

  it("revokes only certificates created after the snapshot when applied", async () => {
    const fetchImpl = vi.fn(async (_url, options = {}) => {
      if ((options.method ?? "GET") === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({ data: [certificate("old"), certificate("new")] }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    });

    await expect(
      revokeCertificatesCreatedSince({
        apply: true,
        beforeIds: ["old"],
        fetchImpl,
        token: "token",
      }),
    ).resolves.toEqual(["new"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "https://api.appstoreconnect.apple.com/v1/certificates/new",
    );
    expect(fetchImpl.mock.calls[1][1].method).toBe("DELETE");
  });

  it("fails closed when more than one certificate appears", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: [certificate("new-1"), certificate("new-2")] }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    );

    await expect(
      revokeCertificatesCreatedSince({
        apply: true,
        beforeIds: [],
        fetchImpl,
        token: "token",
      }),
    ).rejects.toThrow("Refusing to revoke 2 certificates");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
