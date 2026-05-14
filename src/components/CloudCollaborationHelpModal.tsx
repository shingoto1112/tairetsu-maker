import { LockKeyhole, RefreshCw, Save, Users, X } from "lucide-react";

type CloudCollaborationHelpModalProps = {
  onClose: () => void;
};

export const CloudCollaborationHelpModal = ({
  onClose,
}: CloudCollaborationHelpModalProps) => (
  <div className="modal-backdrop" role="presentation">
    <section
      aria-label="共同作業の使い方"
      aria-modal="true"
      className="cloud-help-modal"
      role="dialog"
    >
      <header className="modal-header">
        <div>
          <p className="modal-kicker">クラウド共同作業</p>
          <h2>共同作業の使い方</h2>
        </div>
        <button
          aria-label="閉じる"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <X size={18} />
        </button>
      </header>

      <div className="cloud-help-list">
        <article>
          <LockKeyhole size={18} />
          <div>
            <h3>最初は閲覧モード</h3>
            <p>
              クラウド隊列表は、開いただけでは編集されません。編集したいシーンで
              「このシーンを編集」を押すと、そのシーンのロックを取ります。
            </p>
          </div>
        </article>
        <article>
          <Users size={18} />
          <div>
            <h3>同じシーンは1人だけ</h3>
            <p>
              同じシーンを同時に編集できるのは1人だけです。別のシーンなら、
              ほかの人も同時に編集できます。
            </p>
          </div>
        </article>
        <article>
          <Save size={18} />
          <div>
            <h3>保存すると共有されます</h3>
            <p>
              編集後に「クラウド保存」を押すと、ほかの参加者に更新通知が出ます。
              ドラッグ中の位置は送信されません。
            </p>
          </div>
        </article>
        <article>
          <RefreshCw size={18} />
          <div>
            <h3>更新は手動で読み込み</h3>
            <p>
              ほかの人が保存しても自動では切り替わりません。「更新を再読み込み」を
              押して最新状態を取り込みます。
            </p>
          </div>
        </article>
      </div>

      <div className="cloud-help-note">
        ownerだけが、共有管理、メンバー名簿、道具マスター、音源設定、
        シーン構成、クラウド上書きを操作できます。
      </div>
    </section>
  </div>
);
