import {
  CloudDownload,
  CloudUpload,
  Eye,
  LockKeyhole,
  RefreshCw,
  Save,
  UserPlus,
  Users,
  X,
} from "lucide-react";

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
            <h3>配置は対象ごとにロック</h3>
            <p>
              メンバーや道具を動かすときは、ドラッグ開始時にその対象だけロックします。
              ほかの人は別のメンバーや道具を同じシーン内で編集できます。
            </p>
          </div>
        </article>
        <article>
          <Users size={18} />
          <div>
            <h3>同じ対象は1人だけ</h3>
            <p>
              同じメンバーや同じ道具を同時に編集できるのは1人だけです。
              表示切替やメモなど一部操作は、必要に応じてシーン全体ロックを使います。
            </p>
          </div>
        </article>
        <article>
          <Eye size={18} />
          <div>
            <h3>閲覧中の人が分かります</h3>
            <p>
              ほかの参加者がどのシーンを見ているか、シーン小窓とクラウド表示に
              出ます。編集中のシーンは、これまで通りロック表示が優先されます。
            </p>
          </div>
        </article>
        <article>
          <UserPlus size={18} />
          <div>
            <h3>連絡先から追加</h3>
            <p>
              一度つながった相手は連絡先に登録できます。ownerは共有管理から、
              招待リンクを送り直さずに連絡先を参加者へ追加できます。
            </p>
          </div>
        </article>
        <article>
          <Save size={18} />
          <div>
            <h3>保存すると共有されます</h3>
            <p>
              メンバーや道具の移動は、操作が終わったタイミングで対象だけ保存します。
              ドラッグ中の位置は送信されません。
            </p>
          </div>
        </article>
        <article>
          <RefreshCw size={18} />
          <div>
            <h3>安全なときは自動で読み込み</h3>
            <p>
              閲覧中で未保存変更がない場合は、ほかの人の保存を自動で読み込みます。
              編集中や未保存変更がある場合は、通知から手動で取り込みます。
            </p>
          </div>
        </article>
        <article>
          <CloudDownload size={18} />
          <div>
            <h3>バックアップを残せます</h3>
            <p>
              共有と書き出しからPDFやZIP / .tairetsuを書き出せます。クラウドで
              大きく編集する前は、ローカルへ複製して控えを作ると安心です。
            </p>
          </div>
        </article>
        <article>
          <CloudUpload size={18} />
          <div>
            <h3>困ったら戻せます</h3>
            <p>
              ownerはローカルのJSON / ZIP / .tairetsuでクラウドを上書きできます。
              競合やロック喪失時は、未保存内容をJSONとして退避できます。
            </p>
          </div>
        </article>
      </div>

      <div className="cloud-help-note">
        ownerだけが、共有管理、メンバー名簿、道具マスター、音源設定、
        シーン構成、クラウド上書きを操作できます。editorはシーン内の配置やメモ、
        viewerは閲覧だけを担当します。
      </div>
    </section>
  </div>
);
