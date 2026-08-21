import { sign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const API_BASE_URL = "https://api.appstoreconnect.apple.com/v1";
const DEFAULT_MAX_REVOKE_COUNT = 1;
const TOKEN_AUDIENCE = "appstoreconnect-v1";
const TOKEN_LIFETIME_SECONDS = 15 * 60;

const encodeJson = (value) =>
  Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

export const createAppStoreConnectToken = ({
  issuerId,
  keyId,
  privateKey,
  nowSeconds = Math.floor(Date.now() / 1000),
}) => {
  const header = encodeJson({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = encodeJson({
    aud: TOKEN_AUDIENCE,
    exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    iat: nowSeconds - 5,
    iss: issuerId,
  });
  const unsignedToken = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsignedToken), {
    dsaEncoding: "ieee-p1363",
    key: privateKey,
  }).toString("base64url");
  return `${unsignedToken}.${signature}`;
};

const requestAppStoreConnect = async (
  path,
  { fetchImpl = fetch, method = "GET", token },
) => {
  const response = await fetchImpl(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    method,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `App Store Connect API ${method} ${path} failed (${response.status})${body ? `: ${body}` : ""}`,
    );
  }
  if (response.status === 204) {
    return null;
  }
  return response.json();
};

export const listDevelopmentCertificates = async ({ fetchImpl, token }) => {
  const query = new URLSearchParams({
    "fields[certificates]":
      "name,displayName,certificateType,platform,expirationDate,activated",
    "filter[certificateType]": "DEVELOPMENT",
    limit: "200",
  });
  const response = await requestAppStoreConnect(`/certificates?${query}`, {
    fetchImpl,
    token,
  });
  return Array.isArray(response?.data) ? response.data : [];
};

export const isEphemeralApiDevelopmentCertificate = (certificate) => {
  const attributes = certificate?.attributes ?? {};
  const label = `${attributes.name ?? ""} ${attributes.displayName ?? ""}`;
  return (
    certificate?.type === "certificates" &&
    attributes.certificateType === "DEVELOPMENT" &&
    attributes.activated !== false &&
    label.includes("Created via API")
  );
};

export const findCertificatesCreatedSince = (beforeIds, certificates) => {
  const knownIds = new Set(beforeIds);
  return certificates.filter(
    (certificate) =>
      !knownIds.has(certificate.id) &&
      isEphemeralApiDevelopmentCertificate(certificate),
  );
};

export const revokeCertificatesCreatedSince = async ({
  apply = false,
  beforeIds,
  fetchImpl,
  maxRevokeCount = DEFAULT_MAX_REVOKE_COUNT,
  token,
}) => {
  const certificates = await listDevelopmentCertificates({ fetchImpl, token });
  const created = findCertificatesCreatedSince(beforeIds, certificates);
  if (created.length > maxRevokeCount) {
    throw new Error(
      `Refusing to revoke ${created.length} certificates; expected at most ${maxRevokeCount}.`,
    );
  }
  if (apply) {
    for (const certificate of created) {
      await requestAppStoreConnect(
        `/certificates/${encodeURIComponent(certificate.id)}`,
        {
        fetchImpl,
        method: "DELETE",
        token,
        },
      );
    }
  }
  return created.map((certificate) => certificate.id);
};

const readOption = (args, optionName) => {
  const index = args.indexOf(optionName);
  return index >= 0 ? args[index + 1] : undefined;
};

const getCredentials = async () => {
  const issuerId = process.env.APP_STORE_CONNECT_API_ISSUER_ID;
  const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID;
  const privateKeyPath = process.env.APP_STORE_CONNECT_API_KEY_PATH;
  if (!issuerId || !keyId || !privateKeyPath) {
    throw new Error(
      "APP_STORE_CONNECT_API_ISSUER_ID, APP_STORE_CONNECT_API_KEY_ID, and APP_STORE_CONNECT_API_KEY_PATH are required.",
    );
  }
  return {
    issuerId,
    keyId,
    privateKey: await readFile(privateKeyPath, "utf8"),
  };
};

const runCli = async () => {
  const [command, ...args] = process.argv.slice(2);
  const token = createAppStoreConnectToken(await getCredentials());

  if (command === "snapshot") {
    const outputPath = readOption(args, "--output");
    if (!outputPath) {
      throw new Error("snapshot requires --output <path>.");
    }
    const certificates = await listDevelopmentCertificates({ token });
    const snapshot = {
      capturedAt: new Date().toISOString(),
      ids: certificates.map((certificate) => certificate.id),
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    console.log(`Captured ${snapshot.ids.length} development certificate IDs.`);
    return;
  }

  if (command === "cleanup-created") {
    const beforePath = readOption(args, "--before");
    if (!beforePath) {
      throw new Error("cleanup-created requires --before <snapshot path>.");
    }
    const before = JSON.parse(await readFile(beforePath, "utf8"));
    const apply = args.includes("--apply");
    const ids = await revokeCertificatesCreatedSince({
      apply,
      beforeIds: Array.isArray(before.ids) ? before.ids : [],
      token,
    });
    console.log(
      `${apply ? "Revoked" : "Would revoke"} ${ids.length} certificate(s) created by this run.`,
    );
    return;
  }

  throw new Error(
    "Usage: apple-signing-certificates.mjs snapshot --output <path> | cleanup-created --before <path> [--apply]",
  );
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
