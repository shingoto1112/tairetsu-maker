import type { ProjectSummary } from "../repositories/types";
import type { ParticipantAuthState } from "./guestAuth";
import type { SharedDocumentSummary } from "./managementTransport";

/** Cloud-only card in the home grid. Metadata only: never tokens, e-mail or document content. */
export type CloudLibraryCard = {
  documentId: string;
  title: string;
  badge: string;
  detail: string;
  openable: boolean;
  note: string;
};

/** Documents of the signed-in account that this device has not stored yet (account + documentId, never titles). */
export const cloudOnlyDocuments = (
  documents: readonly SharedDocumentSummary[],
  summaries: readonly ProjectSummary[],
  userId: string,
): SharedDocumentSummary[] => {
  const local = new Set(summaries.filter((summary) => summary.sharing?.accountId === userId).map((summary) => summary.sharing!.documentId));
  return documents.filter((document) => !local.has(document.documentId));
};

const createdDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "日付不明" : date.toLocaleDateString("ja-JP");
};

/** Server order is kept; local cards come first in the grid. */
export const toCloudLibraryCards = (
  documents: readonly SharedDocumentSummary[],
  summaries: readonly ProjectSummary[],
  auth: ParticipantAuthState | undefined,
): CloudLibraryCard[] => auth?.status !== "signed-in" ? [] : cloudOnlyDocuments(documents, summaries, auth.userId).map((document) => ({
  documentId: document.documentId,
  title: document.title || "名称未設定",
  badge: document.memberCount > 1 ? `共有中・${document.memberCount}人` : "クラウド",
  detail: `${document.isCreator ? "自分が作成" : "参加中"}・作成日 ${createdDate(document.createdAt)}`,
  openable: document.documentSchema === 2,
  note: document.documentSchema === 2 ? "この端末に取り込んで開く" : "このアプリでは開けない形式です",
}));

export type LibraryAccountButton = { label: "アカウント" | "ログイン"; pending: boolean };

/** Until sign-in is known, show a disabled "アカウント" so the label does not flip after Keychain restore. */
export const libraryAccountButton = (auth: ParticipantAuthState | undefined, failed = false): LibraryAccountButton => {
  if (!auth || auth.status === "restoring") return { label: "アカウント", pending: !failed };
  return auth.status === "signed-in" ? { label: "アカウント", pending: false } : { label: "ログイン", pending: false };
};
