import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CircleHelp,
  Cloud,
  CloudUpload,
  Copy,
  Download,
  Edit3,
  EyeOff,
  ExternalLink,
  Folder,
  LogIn,
  LogOut,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserRoundCog,
  X,
} from "lucide-react";
import type { CloudProjectSummary } from "../cloud";
import type {
  FormationMode,
  HorizontalGuideMode,
  ParadeHorizontalMeasureMode,
  ParadeRulerPosition,
  ParadeSettings,
  Project,
} from "../types";
import { CloudCollaborationHelpModal } from "./CloudCollaborationHelpModal";
import {
  CloudAccountModal,
  type CloudAccountDeleteResponse,
} from "./CloudAccountModal";
import type { CloudPasswordChangeResponse } from "./CloudPasswordModal";
import { NumericInput } from "./NumericInput";

export type NewFormationInput = {
  title: string;
  formationMode: FormationMode;
  widthMeters: number;
  heightMeters: number;
  useGlobalStageSize: boolean;
  gridSizeMeters: number;
  horizontalGuideMode: HorizontalGuideMode;
  memberDiameterMeters: number;
  paradeSettings?: ParadeSettings;
  audioFile: File | null;
};

type FormationLibraryProps = {
  projects: Project[];
  notice?: string | null;
  cloud?: {
    configured: boolean;
    error?: string | null;
    isBusy: boolean;
    personalMode?: boolean;
    pendingInviteToken?: string | null;
    projects: CloudProjectSummary[];
    userDisplayName?: string;
    userEmail?: string;
    onAcceptInvite: (inviteToken: string) => void | Promise<void>;
    onChangePassword: (
      currentPassword: string,
      newPassword: string,
    ) => Promise<CloudPasswordChangeResponse>;
    onCopyCloudProjectToLocal: (project: CloudProjectSummary) => void | Promise<void>;
    onDeleteCloudProject: (project: CloudProjectSummary) => void | Promise<void>;
    onDeleteAccount: (password: string) => Promise<CloudAccountDeleteResponse>;
    onHideCloudProject: (project: CloudProjectSummary) => void | Promise<void>;
    onOpenCloudProject: (project: CloudProjectSummary) => void | Promise<void>;
    onRefresh: () => void | Promise<void>;
    onRequestPasswordReset: (
      email: string,
    ) => Promise<CloudPasswordChangeResponse>;
    onResendConfirmation: (
      email: string,
    ) => Promise<CloudPasswordChangeResponse>;
    onSignIn: (email: string, password: string) => void | Promise<void>;
    onSignOut: () => void | Promise<void>;
    onSignUp: (
      email: string,
      password: string,
      displayName: string,
    ) => void | Promise<void>;
    onUploadProject: (project: Project) => void | Promise<void>;
  };
  onCreate: (input: NewFormationInput) => void | Promise<void>;
  onOpenProject: (project: Project) => void | Promise<void>;
  onRenameProject: (projectId: string, title: string) => void | Promise<void>;
  onDuplicateProject: (project: Project) => void | Promise<void>;
  onExportProject: (project: Project, includeAudio: boolean) => void | Promise<void>;
  onImportProjectFile: (file: File) => void | Promise<void>;
  onDeleteProject: (project: Project) => void | Promise<void>;
};

type LibraryMenu = {
  projectId: string;
  left: number;
  top: number;
};

const MENU_WIDTH = 196;
const MENU_HEIGHT = 230;
const MENU_MARGIN = 12;

const clampMenuPosition = (left: number, top: number): { left: number; top: number } => {
  const maxLeft = Math.max(MENU_MARGIN, window.innerWidth - MENU_WIDTH - MENU_MARGIN);
  const maxTop = Math.max(MENU_MARGIN, window.innerHeight - MENU_HEIGHT - MENU_MARGIN);
  return {
    left: Math.min(Math.max(MENU_MARGIN, left), maxLeft),
    top: Math.min(Math.max(MENU_MARGIN, top), maxTop),
  };
};

const formatProjectDate = (project: Project): string => {
  const raw = project.lastOpenedAt ?? project.updatedAt ?? project.createdAt;
  if (!raw) {
    return "日時なし";
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return "日時なし";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const isActivationKey = (event: KeyboardEvent<HTMLElement>): boolean =>
  event.key === "Enter" || event.key === " ";

const formatCloudProjectRole = (role: CloudProjectSummary["role"]): string => {
  if (role === "owner") {
    return "所有者";
  }
  if (role === "editor") {
    return "編集者";
  }
  return "閲覧のみ";
};

const CLOUD_PASSWORD_MIN_LENGTH = 6;

export const FormationLibrary = ({
  projects,
  notice,
  cloud,
  onCreate,
  onOpenProject,
  onRenameProject,
  onDuplicateProject,
  onExportProject,
  onImportProjectFile,
  onDeleteProject,
}: FormationLibraryProps) => {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isTypeDialogOpen, setIsTypeDialogOpen] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formationMode, setFormationMode] = useState<FormationMode>("stage");
  const [title, setTitle] = useState("");
  const [widthMeters, setWidthMeters] = useState(12);
  const [heightMeters, setHeightMeters] = useState(8);
  const [useGlobalStageSize, setUseGlobalStageSize] = useState(true);
  const [gridSizeMeters, setGridSizeMeters] = useState(0.25);
  const [horizontalGuideMode, setHorizontalGuideMode] =
    useState<HorizontalGuideMode>("meters");
  const [memberDiameterMeters, setMemberDiameterMeters] = useState(0.5);
  const [paradeTotalDistance, setParadeTotalDistance] = useState(100);
  const [paradeWidthMeters, setParadeWidthMeters] = useState(20);
  const [paradeCellSizeMeters, setParadeCellSizeMeters] = useState(1);
  const [paradeRulerPosition, setParadeRulerPosition] =
    useState<ParadeRulerPosition>("both");
  const [paradeHorizontalMeasureMode, setParadeHorizontalMeasureMode] =
    useState<ParadeHorizontalMeasureMode>("centerSplit");
  const [paradeEmphasizeEvery5m, setParadeEmphasizeEvery5m] = useState(true);
  const [paradeEmphasizeEvery10m, setParadeEmphasizeEvery10m] = useState(true);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libraryMenu, setLibraryMenu] = useState<LibraryMenu | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [cloudDeleteTarget, setCloudDeleteTarget] =
    useState<CloudProjectSummary | null>(null);
  const [cloudHideTarget, setCloudHideTarget] =
    useState<CloudProjectSummary | null>(null);
  const [exportTarget, setExportTarget] = useState<Project | null>(null);
  const [includeAudioInExport, setIncludeAudioInExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [cloudDisplayName, setCloudDisplayName] = useState("");
  const [cloudEmail, setCloudEmail] = useState("");
  const [cloudPassword, setCloudPassword] = useState("");
  const [cloudFormError, setCloudFormError] = useState<string | null>(null);
  const [cloudFormNotice, setCloudFormNotice] = useState<string | null>(null);
  const [cloudInviteToken, setCloudInviteToken] = useState("");
  const [isCloudHelpOpen, setIsCloudHelpOpen] = useState(false);
  const [isCloudAccountOpen, setIsCloudAccountOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const aTime = Date.parse(a.lastOpenedAt ?? a.updatedAt ?? a.createdAt ?? "");
        const bTime = Date.parse(b.lastOpenedAt ?? b.updatedAt ?? b.createdAt ?? "");
        return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
      }),
    [projects],
  );

  useEffect(() => {
    if (cloud?.pendingInviteToken) {
      setCloudInviteToken(cloud.pendingInviteToken);
    }
  }, [cloud?.pendingInviteToken]);

  const menuProject =
    libraryMenu === null
      ? null
      : sortedProjects.find((project) => project.id === libraryMenu.projectId) ?? null;
  const visibleCloudProjects = cloud?.personalMode
    ? cloud.projects.filter((project) => project.role === "owner")
    : cloud?.projects ?? [];

  useEffect(() => {
    if (!libraryMenu) {
      return undefined;
    }
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setLibraryMenu(null);
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setLibraryMenu(null);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [libraryMenu]);

  const resetDialog = () => {
    setFormationMode("stage");
    setTitle("");
    setWidthMeters(12);
    setHeightMeters(8);
    setUseGlobalStageSize(true);
    setGridSizeMeters(0.25);
    setHorizontalGuideMode("meters");
    setMemberDiameterMeters(0.5);
    setParadeTotalDistance(100);
    setParadeWidthMeters(20);
    setParadeCellSizeMeters(1);
    setParadeRulerPosition("both");
    setParadeHorizontalMeasureMode("centerSplit");
    setParadeEmphasizeEvery5m(true);
    setParadeEmphasizeEvery10m(true);
    setAudioFile(null);
    setError(null);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    resetDialog();
  };

  const openCreateTypeDialog = () => {
    setIsAddDialogOpen(false);
    setIsTypeDialogOpen(true);
  };

  const openCreateDialog = (nextMode: FormationMode) => {
    resetDialog();
    setFormationMode(nextMode);
    setIsTypeDialogOpen(false);
    setIsDialogOpen(true);
  };

  const handleAudioFile = (event: ChangeEvent<HTMLInputElement>) => {
    setAudioFile(event.target.files?.[0] ?? null);
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    setIsImporting(true);
    try {
      await onImportProjectFile(file);
      setIsAddDialogOpen(false);
    } finally {
      setIsImporting(false);
    }
  };

  const validatePositive = (value: number, label: string): string | null => {
    if (!Number.isFinite(value) || value <= 0) {
      return `${label}は0より大きい数値にしてください。`;
    }
    return null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("隊列表名を入力してください。");
      return;
    }
    const validationError =
      formationMode === "parade"
        ? validatePositive(paradeTotalDistance, "全体距離") ??
          validatePositive(paradeWidthMeters, "横幅") ??
          validatePositive(paradeCellSizeMeters, "1マスあたりの距離") ??
          validatePositive(memberDiameterMeters, "メンバー円の直径")
        : validatePositive(widthMeters, "ステージ横幅") ??
          validatePositive(heightMeters, "ステージ縦幅") ??
          validatePositive(gridSizeMeters, "グリッド間隔") ??
          validatePositive(memberDiameterMeters, "メンバー円の直径");
    if (validationError) {
      setError(validationError);
      return;
    }
    const isParade = formationMode === "parade";
    await onCreate({
      title: trimmedTitle,
      formationMode,
      widthMeters: isParade ? paradeWidthMeters : widthMeters,
      heightMeters: isParade ? paradeTotalDistance : heightMeters,
      useGlobalStageSize: isParade ? true : useGlobalStageSize,
      gridSizeMeters: isParade ? paradeCellSizeMeters : gridSizeMeters,
      horizontalGuideMode,
      memberDiameterMeters,
      paradeSettings: isParade
        ? {
            totalDistance: paradeTotalDistance,
            width: paradeWidthMeters,
            cellSizeMeters: paradeCellSizeMeters,
            direction: "up",
            rulerPosition: paradeRulerPosition,
            horizontalMeasureMode: paradeHorizontalMeasureMode,
            emphasizeEvery5m: paradeEmphasizeEvery5m,
            emphasizeEvery10m: paradeEmphasizeEvery10m,
          }
        : undefined,
      audioFile,
    });
    closeDialog();
  };

  const openMenu = (
    project: Project,
    event: MouseEvent<HTMLElement>,
    anchor?: "button",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const point =
      anchor === "button"
        ? {
            left: event.currentTarget.getBoundingClientRect().right - MENU_WIDTH,
            top: event.currentTarget.getBoundingClientRect().bottom + 6,
          }
        : { left: event.clientX, top: event.clientY };
    setLibraryMenu({
      projectId: project.id ?? "",
      ...clampMenuPosition(point.left, point.top),
    });
  };

  const runMenuAction = async (action: () => void | Promise<void>) => {
    await action();
    setLibraryMenu(null);
  };

  const openRenameDialog = (project: Project) => {
    setRenameTarget(project);
    setRenameTitle(project.title || "");
    setLibraryMenu(null);
  };

  const openExportDialog = (project: Project) => {
    setExportTarget(project);
    setIncludeAudioInExport(false);
    setLibraryMenu(null);
  };

  const submitRename = async (event: FormEvent) => {
    event.preventDefault();
    if (!renameTarget?.id) return;
    const nextTitle = renameTitle.trim();
    if (!nextTitle) return;
    await onRenameProject(renameTarget.id, nextTitle);
    setRenameTarget(null);
    setRenameTitle("");
  };

  const submitDelete = async () => {
    if (!deleteTarget) return;
    await onDeleteProject(deleteTarget);
    setDeleteTarget(null);
  };

  const submitCloudDelete = async () => {
    if (!cloud || !cloudDeleteTarget) return;
    await cloud.onDeleteCloudProject(cloudDeleteTarget);
    setCloudDeleteTarget(null);
  };

  const submitCloudHide = async () => {
    if (!cloud || !cloudHideTarget) return;
    await cloud.onHideCloudProject(cloudHideTarget);
    setCloudHideTarget(null);
  };

  const submitExport = async () => {
    if (!exportTarget) return;
    setIsExporting(true);
    try {
      await onExportProject(exportTarget, includeAudioInExport && Boolean(exportTarget.audio?.id));
      setExportTarget(null);
      setIncludeAudioInExport(false);
    } finally {
      setIsExporting(false);
    }
  };

  const submitCloudAuth = async (mode: "signIn" | "signUp") => {
    const displayName = cloudDisplayName.trim();
    const email = cloudEmail.trim();
    if (!cloud) {
      return;
    }
    if (mode === "signUp" && !displayName) {
      setCloudFormError("新規登録では表示名を入力してください。");
      return;
    }
    if (!email || !cloudPassword) {
      setCloudFormError("メールアドレスとパスワードを入力してください。");
      return;
    }
    if (mode === "signUp" && cloudPassword.length < CLOUD_PASSWORD_MIN_LENGTH) {
      setCloudFormError(
        `新規登録のパスワードは${CLOUD_PASSWORD_MIN_LENGTH}文字以上で入力してください。`,
      );
      return;
    }
    setCloudFormError(null);
    setCloudFormNotice(null);
    if (mode === "signIn") {
      await cloud.onSignIn(email, cloudPassword);
    } else {
      await cloud.onSignUp(email, cloudPassword, displayName);
    }
  };

  const submitCloudEmailAction = async (
    mode: "passwordReset" | "resendConfirmation",
  ) => {
    if (!cloud) {
      return;
    }
    const email = cloudEmail.trim();
    if (!email) {
      setCloudFormNotice(null);
      setCloudFormError("メールアドレスを入力してください。");
      return;
    }
    setCloudFormError(null);
    setCloudFormNotice(null);
    const result =
      mode === "passwordReset"
        ? await cloud.onRequestPasswordReset(email)
        : await cloud.onResendConfirmation(email);
    if (result.success) {
      setCloudFormNotice(result.message);
    } else {
      setCloudFormError(result.message);
    }
  };

  const submitCloudInvite = async () => {
    if (!cloud) {
      return;
    }
    const token = cloudInviteToken.trim();
    if (!token) {
      setCloudFormError("招待リンクまたは招待コードを入力してください。");
      return;
    }
    const inviteToken = token.includes("#cloudInvite=")
      ? token.split("#cloudInvite=")[1] ?? ""
      : token;
    setCloudFormError(null);
    await cloud.onAcceptInvite(decodeURIComponent(inviteToken));
    setCloudInviteToken("");
  };

  return (
    <main className="library-shell">
      <header className="library-header">
        <div>
          <p className="library-kicker">隊列表作成アプリ</p>
          <h1>隊列メーカー</h1>
        </div>
        <p>作成済みの隊列表を開くか、新しい隊列表を作成します。</p>
      </header>

      {notice && <p className="library-notice">{notice}</p>}

      {cloud && (
        <section className="library-cloud-panel" aria-label="クラウド">
          <div className="library-cloud-panel__header">
            <div>
              <h2>
                <Cloud size={18} />
                クラウド
              </h2>
              <p>
                {cloud.userEmail
                  ? cloud.personalMode
                    ? "自分専用のクラウド隊列表を保存・読み込みできます。"
                    : "クラウド隊列表を開いて、共有管理からメンバーを招待できます。"
                  : cloud.personalMode
                    ? "ログインすると、隊列表を自分専用のクラウドへ保存できます。"
                    : "ログインすると、隊列表をクラウド保存してほかの人と共同作業できます。"}
              </p>
            </div>
            <div className="library-cloud-header-actions">
              {!cloud.personalMode && (
                <button
                  className="mini-button"
                  onClick={() => setIsCloudHelpOpen(true)}
                  type="button"
                >
                  <CircleHelp size={14} />
                  共同作業の使い方
                </button>
              )}
              {cloud.userEmail && (
                <div className="library-cloud-account">
                  <span>{cloud.userDisplayName || "ログイン中"}</span>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => setIsCloudAccountOpen(true)}
                    disabled={cloud.isBusy}
                  >
                    <UserRoundCog size={14} />
                    アカウント
                  </button>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => void cloud.onSignOut()}
                    disabled={cloud.isBusy}
                  >
                    <LogOut size={14} />
                    ログアウト
                  </button>
                </div>
              )}
            </div>
          </div>

          {!cloud.configured ? (
            <p className="library-cloud-message">
              Supabase接続が未設定です。.envに VITE_SUPABASE_URL と
              VITE_SUPABASE_ANON_KEY を設定すると使えます。
            </p>
          ) : cloud.userEmail ? (
            <>
              <div className="library-cloud-actions">
                <button
                  type="button"
                  className="mini-button"
                  onClick={() => void cloud.onRefresh()}
                  disabled={cloud.isBusy}
                >
                  <RefreshCw size={14} />
                  更新
                </button>
                <span>ローカルカードのメニューからクラウドへアップロードできます。</span>
              </div>
              {cloud.error && <p className="dialog-error">{cloud.error}</p>}
              {!cloud.personalMode && (
                <div className="library-cloud-invite">
                  <label>
                    招待リンク / 招待コード
                    <input
                      value={cloudInviteToken}
                      onChange={(event) => setCloudInviteToken(event.target.value)}
                      placeholder="招待リンクを貼り付け"
                    />
                  </label>
                  <button
                    className="mini-button"
                    disabled={cloud.isBusy}
                    onClick={() => void submitCloudInvite()}
                    type="button"
                  >
                    参加
                  </button>
                </div>
              )}
              <div className="library-cloud-list">
                {visibleCloudProjects.length === 0 ? (
                  <p className="library-cloud-message">
                    {cloud.personalMode
                      ? "自分専用のクラウド隊列表はまだありません。過去の隊列表が表示されない場合は、更新を押してください。"
                      : "クラウドプロジェクトはまだありません。過去のクラウド隊列表が表示されない場合は、更新を押してください。"}
                  </p>
                ) : (
                  visibleCloudProjects.map((cloudProject) => (
                    <article
                      key={cloudProject.id}
                      className="library-cloud-project"
                    >
                      <button
                        type="button"
                        className="library-cloud-project__main"
                        onClick={() => void cloud.onOpenCloudProject(cloudProject)}
                        disabled={cloud.isBusy}
                      >
                        <strong>{cloudProject.title || "名称未設定"}</strong>
                        <span>
                          {cloudProject.mode === "parade" ? "パレード" : "ステージ"} /{" "}
                          {cloud.personalMode
                            ? "自分専用"
                            : formatCloudProjectRole(cloudProject.role)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="mini-button library-cloud-project__copy"
                        onClick={() => void cloud.onCopyCloudProjectToLocal(cloudProject)}
                        disabled={cloud.isBusy}
                      >
                        ローカルへ複製
                      </button>
                      <div className="library-cloud-project__actions">
                        {cloudProject.role === "owner" ? (
                          <button
                            type="button"
                            className="mini-button danger"
                            onClick={() => setCloudDeleteTarget(cloudProject)}
                            disabled={cloud.isBusy}
                            aria-label="クラウド隊列表を削除"
                          >
                            <Trash2 size={14} />
                            削除
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="mini-button"
                            onClick={() => setCloudHideTarget(cloudProject)}
                            disabled={cloud.isBusy}
                            aria-label="クラウド隊列表を一覧から非表示"
                          >
                            <EyeOff size={14} />
                            非表示
                          </button>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </>
          ) : (
            <form
              className="library-cloud-login"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCloudAuth("signIn");
              }}
            >
              <label>
                表示名
                <input
                  type="text"
                  value={cloudDisplayName}
                  onChange={(event) => setCloudDisplayName(event.target.value)}
                  autoComplete="name"
                  placeholder="例: しんご"
                />
                <span className="library-cloud-password-hint">
                  {cloud.personalMode
                    ? "新規登録時にアカウントへ設定する名前です"
                    : "新規登録時に、ほかの参加者へこの名前だけが表示されます"}
                </span>
              </label>
              <label>
                メールアドレス
                <input
                  type="email"
                  value={cloudEmail}
                  onChange={(event) => setCloudEmail(event.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                パスワード
                <input
                  type="password"
                  value={cloudPassword}
                  onChange={(event) => setCloudPassword(event.target.value)}
                  autoComplete="current-password"
                  aria-describedby="cloud-password-hint"
                />
                <span className="library-cloud-password-hint" id="cloud-password-hint">
                  新規登録は{CLOUD_PASSWORD_MIN_LENGTH}文字以上
                </span>
              </label>
              {(cloudFormError || cloud.error) && (
                <p className="dialog-error">{cloudFormError ?? cloud.error}</p>
              )}
              {cloudFormNotice && (
                <p className="library-cloud-success">{cloudFormNotice}</p>
              )}
              <div className="library-cloud-actions">
                <button
                  type="submit"
                  className="mini-button primary"
                  disabled={cloud.isBusy}
                >
                  <LogIn size={14} />
                  ログイン
                </button>
                <button
                  type="button"
                  className="mini-button"
                  disabled={cloud.isBusy}
                  onClick={() => void submitCloudAuth("signUp")}
                >
                  新規登録
                </button>
              </div>
              <div className="library-cloud-recovery-actions">
                <button
                  className="library-link-button"
                  disabled={cloud.isBusy}
                  onClick={() => void submitCloudEmailAction("passwordReset")}
                  type="button"
                >
                  パスワードを忘れた場合
                </button>
                <button
                  className="library-link-button"
                  disabled={cloud.isBusy}
                  onClick={() => void submitCloudEmailAction("resendConfirmation")}
                  type="button"
                >
                  確認メールを再送
                </button>
              </div>
            </form>
          )}
        </section>
      )}

      {!cloud?.personalMode && isCloudHelpOpen && (
        <CloudCollaborationHelpModal onClose={() => setIsCloudHelpOpen(false)} />
      )}

      {cloud?.userEmail && isCloudAccountOpen && (
        <CloudAccountModal
          displayName={cloud.userDisplayName}
          email={cloud.userEmail}
          isBusy={cloud.isBusy}
          onClose={() => setIsCloudAccountOpen(false)}
          onChangePassword={cloud.onChangePassword}
          onDeleteAccount={cloud.onDeleteAccount}
        />
      )}

      <section className="library-grid" aria-label="隊列表一覧">
        <button
          className="formation-card formation-card--new"
          onClick={() => setIsAddDialogOpen(true)}
          type="button"
        >
          <span className="formation-card__plus">
            <Plus size={30} />
          </span>
          <strong>追加</strong>
          <small>新規 / 読込</small>
        </button>

        {sortedProjects.map((project, index) => (
          <article
            className="formation-card formation-card--saved"
            key={project.id ?? `${project.title}-${index}`}
            onClick={() => void onOpenProject(project)}
            onContextMenu={(event) => openMenu(project, event)}
            onKeyDown={(event) => {
              if (isActivationKey(event)) {
                event.preventDefault();
                void onOpenProject(project);
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`${project.title || "名称未設定"}を開く`}
          >
            <button
              className="formation-card__menu"
              type="button"
              aria-label={`${project.title || "名称未設定"}のメニュー`}
              onClick={(event) => openMenu(project, event, "button")}
            >
              <MoreHorizontal size={18} />
            </button>
            <span
              className={`formation-folder formation-folder--${(index % 6) + 1}`}
              aria-hidden="true"
            >
              <Folder size={56} />
            </span>
            <span className="formation-card__badge">ローカル</span>
            <strong>{project.title || "名称未設定"}</strong>
            <small>最終使用: {formatProjectDate(project)}</small>
          </article>
        ))}
      </section>

      {sortedProjects.length === 0 && (
        <p className="library-empty">
          まだ保存済みの隊列表はありません。左上の新規作成から始めてください。
        </p>
      )}

      {libraryMenu && menuProject && (
        <div
          className="library-context-menu"
          ref={menuRef}
          style={{ left: libraryMenu.left, top: libraryMenu.top }}
          role="menu"
        >
          <button
            type="button"
            onClick={() => runMenuAction(() => onOpenProject(menuProject))}
          >
            <ExternalLink size={15} />
            開く
          </button>
          <button type="button" onClick={() => openRenameDialog(menuProject)}>
            <Edit3 size={15} />
            名前を変更
          </button>
          <button
            type="button"
            onClick={() => runMenuAction(() => onDuplicateProject(menuProject))}
          >
            <Copy size={15} />
            複製
          </button>
          <button type="button" onClick={() => openExportDialog(menuProject)}>
            <Download size={15} />
            書き出し
          </button>
          {cloud?.userEmail && (
            <button
              type="button"
              onClick={() =>
                runMenuAction(() => cloud.onUploadProject(menuProject))
              }
            >
              <CloudUpload size={15} />
              クラウドへアップロード
            </button>
          )}
          <button
            className="danger"
            type="button"
            onClick={() => {
              setDeleteTarget(menuProject);
              setLibraryMenu(null);
            }}
          >
            <Trash2 size={15} />
            削除
          </button>
        </div>
      )}

      <input
        ref={importInputRef}
        type="file"
        accept=".zip,.tairetsu,application/zip,application/x-zip-compressed,application/octet-stream"
        onChange={(event) => void handleImportFile(event)}
        hidden
      />

      {isAddDialogOpen && (
        <div
          className="new-formation-backdrop"
          onPointerDown={() => setIsAddDialogOpen(false)}
        >
          <div
            className="new-formation-dialog library-small-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隊列表を追加"
          >
            <header>
              <h2>隊列表を追加</h2>
              <button
                className="share-export-close"
                onClick={() => setIsAddDialogOpen(false)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <div className="library-add-options">
              <button type="button" onClick={openCreateTypeDialog}>
                <Plus size={22} />
                <span>
                  <strong>新しく作る</strong>
                  <small>最初から新しい隊列表を作成します。</small>
                </span>
              </button>
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={isImporting}
              >
                <Upload size={22} />
                <span>
                  <strong>読み込む</strong>
                  <small>共有された .zip / .tairetsu ファイルを読み込みます。</small>
                </span>
              </button>
            </div>
            <footer>
              <button
                className="mini-button"
                onClick={() => setIsAddDialogOpen(false)}
                type="button"
              >
                キャンセル
              </button>
            </footer>
          </div>
        </div>
      )}

      {isTypeDialogOpen && (
        <div
          className="new-formation-backdrop"
          onPointerDown={() => setIsTypeDialogOpen(false)}
        >
          <div
            className="new-formation-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="作成タイプを選択"
          >
            <header>
              <h2>作成タイプを選択</h2>
              <button
                className="share-export-close"
                onClick={() => setIsTypeDialogOpen(false)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <div className="formation-type-grid">
              <button
                type="button"
                className="formation-type-card"
                onClick={() => openCreateDialog("stage")}
              >
                <strong>ステージ隊列</strong>
                <span>
                  固定されたステージ上で、シーンごとの隊形を作成します。
                </span>
                <small>ダンスステージ、体育館ステージ、発表会、ライブ向け</small>
              </button>
              <button
                type="button"
                className="formation-type-card"
                onClick={() => openCreateDialog("parade")}
              >
                <strong>パレード隊列</strong>
                <span>
                  長い移動ルート上で、前進しながら変化する隊形を作成します。
                </span>
                <small>パレード、行進、縦長い演出向け</small>
              </button>
            </div>
            <footer>
              <button
                className="mini-button"
                onClick={() => setIsTypeDialogOpen(false)}
                type="button"
              >
                キャンセル
              </button>
            </footer>
          </div>
        </div>
      )}

      {isDialogOpen && (
        <div className="new-formation-backdrop" onPointerDown={closeDialog}>
          <form
            className="new-formation-dialog"
            onSubmit={(event) => void submit(event)}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="新しい隊列表を作成"
          >
            <header>
              <h2>
                {formationMode === "parade"
                  ? "新しいパレード隊列を作成"
                  : "新しいステージ隊列を作成"}
              </h2>
              <button
                className="share-export-close"
                onClick={closeDialog}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>

            <label>
              隊列表名
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例：2026春 オープニング"
                autoFocus
              />
            </label>

            <label>
              音源
              <input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={handleAudioFile} />
              <small>{audioFile ? audioFile.name : "任意です。音源なしでも作成できます。"}</small>
            </label>

            {formationMode === "stage" ? (
              <section className="new-formation-size">
                <h3>ステージ設定</h3>
                <p className="notice muted">
                  現在: 横{widthMeters || 0}m / 縦{heightMeters || 0}m /{" "}
                  {useGlobalStageSize ? "全シーン固定ON" : "シーン別サイズ"}
                </p>
                <label>
                  全シーン固定
                  <select
                    value={String(useGlobalStageSize)}
                    onChange={(event) => setUseGlobalStageSize(event.target.value === "true")}
                  >
                    <option value="true">ON</option>
                    <option value="false">OFF</option>
                  </select>
                </label>
                <label>
                  横幅
                  <span className="meter-input">
                    <NumericInput
                      min={0.1}
                      step="0.1"
                      value={widthMeters}
                      onValueChange={setWidthMeters}
                    />
                    m
                  </span>
                </label>
                <label>
                  縦幅
                  <span className="meter-input">
                    <NumericInput
                      min={0.1}
                      step="0.1"
                      value={heightMeters}
                      onValueChange={setHeightMeters}
                    />
                    m
                  </span>
                </label>
                <label>
                  グリッド間隔
                  <span className="meter-input">
                    <NumericInput
                      min={0.05}
                      step="0.05"
                      value={gridSizeMeters}
                      onValueChange={setGridSizeMeters}
                    />
                    m
                  </span>
                </label>
                <label>
                  横方向の表示
                  <select
                    value={horizontalGuideMode}
                    onChange={(event) =>
                      setHorizontalGuideMode(event.target.value as HorizontalGuideMode)
                    }
                  >
                    <option value="meters">通常メートル表示</option>
                    <option value="centerSplit">センター割り表示</option>
                  </select>
                </label>
                <label>
                  メンバー円の直径
                  <span className="meter-input">
                    <NumericInput
                      min={0.1}
                      step="0.05"
                      value={memberDiameterMeters}
                      onValueChange={setMemberDiameterMeters}
                    />
                    m
                  </span>
                </label>
              </section>
            ) : (
              <section className="new-formation-size">
                <h3>パレード設定</h3>
                <p className="notice muted">
                  現在: 全体距離{paradeTotalDistance || 0}m / 横幅
                  {paradeWidthMeters || 0}m / 1マス={paradeCellSizeMeters || 0}m
                </p>
                <label>
                  全体距離
                  <span className="meter-input">
                    <NumericInput
                      min={1}
                      step="1"
                      value={paradeTotalDistance}
                      onValueChange={setParadeTotalDistance}
                    />
                    m
                  </span>
                </label>
                <label>
                  横幅
                  <span className="meter-input">
                    <NumericInput
                      min={1}
                      step="0.5"
                      value={paradeWidthMeters}
                      onValueChange={setParadeWidthMeters}
                    />
                    m
                  </span>
                </label>
                <label>
                  1マスあたりの距離
                  <span className="meter-input">
                    <NumericInput
                      min={0.1}
                      step="0.1"
                      value={paradeCellSizeMeters}
                      onValueChange={setParadeCellSizeMeters}
                    />
                    m
                  </span>
                </label>
                <label>
                  横方向表示方式
                  <select
                    value={paradeHorizontalMeasureMode}
                    onChange={(event) =>
                      setParadeHorizontalMeasureMode(
                        event.target.value as ParadeHorizontalMeasureMode,
                      )
                    }
                  >
                    <option value="centerSplit">センター割り方式</option>
                    <option value="normalMeter">通常m表示</option>
                  </select>
                </label>
                <label>
                  進行方向
                  <select value="up" disabled>
                    <option value="up">上方向</option>
                  </select>
                </label>
                <label>
                  距離目盛り表示
                  <select
                    value={paradeRulerPosition}
                    onChange={(event) =>
                      setParadeRulerPosition(event.target.value as ParadeRulerPosition)
                    }
                  >
                    <option value="both">左右に表示</option>
                    <option value="left">左のみ表示</option>
                    <option value="right">右のみ表示</option>
                    <option value="none">非表示</option>
                  </select>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={paradeEmphasizeEvery5m}
                    onChange={(event) => setParadeEmphasizeEvery5m(event.target.checked)}
                  />
                  5mごとのライン強調
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={paradeEmphasizeEvery10m}
                    onChange={(event) => setParadeEmphasizeEvery10m(event.target.checked)}
                  />
                  10mごとのライン強調
                </label>
                <label>
                  メンバー円の直径
                  <span className="meter-input">
                    <NumericInput
                      min={0.1}
                      step="0.05"
                      value={memberDiameterMeters}
                      onValueChange={setMemberDiameterMeters}
                    />
                    m
                  </span>
                </label>
                <small>作成後の初期表示はスタート地点です。</small>
              </section>
            )}

            {error && <p className="dialog-error">{error}</p>}

            <footer>
              <button className="mini-button" onClick={closeDialog} type="button">
                キャンセル
              </button>
              <button className="mini-button primary" type="submit">
                作成する
              </button>
            </footer>
          </form>
        </div>
      )}

      {renameTarget && (
        <div className="new-formation-backdrop" onPointerDown={() => setRenameTarget(null)}>
          <form
            className="new-formation-dialog library-small-dialog"
            onSubmit={(event) => void submitRename(event)}
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隊列表名を変更"
          >
            <header>
              <h2>名前を変更</h2>
              <button
                className="share-export-close"
                onClick={() => setRenameTarget(null)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <label>
              隊列表名
              <input
                value={renameTitle}
                onChange={(event) => setRenameTitle(event.target.value)}
                autoFocus
              />
            </label>
            <footer>
              <button
                className="mini-button"
                onClick={() => setRenameTarget(null)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="mini-button primary"
                type="submit"
                disabled={!renameTitle.trim()}
              >
                保存
              </button>
            </footer>
          </form>
        </div>
      )}

      {exportTarget && (
        <div className="new-formation-backdrop" onPointerDown={() => setExportTarget(null)}>
          <div
            className="new-formation-dialog library-small-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隊列表を書き出し"
          >
            <header>
              <h2>隊列表を書き出し</h2>
              <button
                className="share-export-close"
                onClick={() => setExportTarget(null)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <p className="notice">
              「{exportTarget.title || "名称未設定"}」を .zip ファイルとして書き出します。
            </p>
            <label className="library-export-check">
              <input
                type="checkbox"
                checked={includeAudioInExport}
                onChange={(event) => setIncludeAudioInExport(event.target.checked)}
                disabled={!exportTarget.audio?.id}
              />
              音源ファイルも含める
            </label>
            {!exportTarget.audio?.id && (
              <p className="notice muted">音源は設定されていません。</p>
            )}
            <footer>
              <button
                className="mini-button"
                onClick={() => setExportTarget(null)}
                type="button"
                disabled={isExporting}
              >
                キャンセル
              </button>
              <button
                className="mini-button primary"
                onClick={() => void submitExport()}
                type="button"
                disabled={isExporting}
              >
                書き出す
              </button>
            </footer>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="new-formation-backdrop" onPointerDown={() => setDeleteTarget(null)}>
          <div
            className="new-formation-dialog library-small-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="隊列表を削除"
          >
            <header>
              <h2>隊列表を削除しますか？</h2>
              <button
                className="share-export-close"
                onClick={() => setDeleteTarget(null)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <p className="notice">
              「{deleteTarget.title || "名称未設定"}」を削除します。この操作は元に戻せません。
            </p>
            <footer>
              <button
                className="mini-button"
                onClick={() => setDeleteTarget(null)}
                type="button"
              >
                キャンセル
              </button>
              <button className="mini-button danger" onClick={() => void submitDelete()} type="button">
                削除する
              </button>
            </footer>
          </div>
        </div>
      )}

      {cloudDeleteTarget && (
        <div
          className="new-formation-backdrop"
          onPointerDown={() => setCloudDeleteTarget(null)}
        >
          <div
            className="new-formation-dialog library-small-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="クラウド隊列表を削除"
          >
            <header>
              <h2>クラウドから削除しますか？</h2>
              <button
                className="share-export-close"
                onClick={() => setCloudDeleteTarget(null)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <p className="notice">
              「{cloudDeleteTarget.title || "名称未設定"}」をクラウド一覧から削除します。
              参加者全員の一覧から表示されなくなります。
            </p>
            <footer>
              <button
                className="mini-button"
                onClick={() => setCloudDeleteTarget(null)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="mini-button danger"
                onClick={() => void submitCloudDelete()}
                type="button"
                disabled={cloud?.isBusy}
              >
                削除する
              </button>
            </footer>
          </div>
        </div>
      )}

      {cloudHideTarget && (
        <div
          className="new-formation-backdrop"
          onPointerDown={() => setCloudHideTarget(null)}
        >
          <div
            className="new-formation-dialog library-small-dialog"
            onPointerDown={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="クラウド隊列表を非表示"
          >
            <header>
              <h2>一覧から非表示にしますか？</h2>
              <button
                className="share-export-close"
                onClick={() => setCloudHideTarget(null)}
                type="button"
                aria-label="閉じる"
              >
                <X size={20} />
              </button>
            </header>
            <p className="notice">
              「{cloudHideTarget.title || "名称未設定"}」を自分のクラウド一覧から隠します。
              クラウド上のデータや他の参加者の一覧には影響しません。
            </p>
            <footer>
              <button
                className="mini-button"
                onClick={() => setCloudHideTarget(null)}
                type="button"
              >
                キャンセル
              </button>
              <button
                className="mini-button"
                onClick={() => void submitCloudHide()}
                type="button"
                disabled={cloud?.isBusy}
              >
                非表示にする
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  );
};
