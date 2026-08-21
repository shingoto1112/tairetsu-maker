import { AlertTriangle, Clipboard, RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  createAppDiagnostic,
  formatAppDiagnostic,
  saveAppDiagnostic,
  type AppDiagnostic,
} from "../utils/diagnostics";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  diagnostic: AppDiagnostic | null;
};

export class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { diagnostic: null };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { diagnostic: createAppDiagnostic("render", error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const diagnostic = createAppDiagnostic(
      "render",
      error,
      info.componentStack ?? undefined,
    );
    saveAppDiagnostic(diagnostic);
    this.setState({ diagnostic });
  }

  private copyDiagnostic = async () => {
    if (!this.state.diagnostic) {
      return;
    }
    const text = formatAppDiagnostic(this.state.diagnostic);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  };

  render() {
    if (!this.state.diagnostic) {
      return this.props.children;
    }
    return (
      <main className="fatal-error-screen">
        <section className="fatal-error-panel" role="alert">
          <AlertTriangle aria-hidden="true" size={32} />
          <h1>画面を表示できませんでした</h1>
          <p>
            端末に保存済みの隊列表は削除されていません。再読み込みして、同じ操作で再発する場合は診断情報を添えてお問い合わせください。
          </p>
          <div className="fatal-error-actions">
            <button className="mini-button primary" onClick={() => window.location.reload()} type="button">
              <RefreshCw size={16} />
              再読み込み
            </button>
            <button className="mini-button" onClick={() => void this.copyDiagnostic()} type="button">
              <Clipboard size={16} />
              診断情報をコピー
            </button>
          </div>
          <small>診断情報には隊列表の内容、氏名、メールアドレスを含めません。</small>
        </section>
      </main>
    );
  }
}
