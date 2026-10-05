import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { HistoryController } from '../collaboration/historyController';
import type { CheckpointSummary } from '../collaboration/historyApi';
import type { SharedMember } from '../collaboration/managementTransport';
import type { SharedSessionStore } from '../storage/sharedSessionState';
import type { ProjectRecord } from '../repositories/types';

const reasons = { automatic: '自動で残した控え', manual: '手動で残した控え', 'before-restore': '戻す直前の控え', 'before-generation': '共有を更新する前の控え' };
export default function CollaborationHistoryPanel({ controller, members, creator, session, open }: {
  controller: HistoryController; members: SharedMember[]; creator: boolean; session: SharedSessionStore; open: (record: ProjectRecord, message: string) => Promise<boolean>;
}) {
  const ui = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const status = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [expanded, setExpanded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ item: CheckpointSummary; action: 'restore' | 'delete' } | null>(null);
  const confirmation = useRef<HTMLDivElement>(null);
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => { if (confirm) { confirmation.current?.focus(); confirmation.current?.scrollIntoView({ block: 'nearest' }); } }, [confirm]);
  useEffect(() => { if (ui.restore || ui.error) result.current?.scrollIntoView({ block: 'nearest' }); }, [ui.restore?.phase, ui.error]);
  const run = (fn: () => Promise<void>) => void controller.run(fn);
  const name = (item: CheckpointSummary) => item.automatic ? '自動' : members.find(m => m.userId === item.requestedBy)?.displayName ?? '以前の参加者';
  const when = (item: CheckpointSummary) => new Date(item.serverAt).toLocaleString('ja-JP');
  const description = (item: CheckpointSummary) => item.automatic ? reasons[item.reason] : `${name(item)} · ${reasons[item.reason]}`;
  const phase = ui.restore?.phase;
  return <section className="collab-history-panel" aria-label="控え（履歴）" aria-busy={ui.busy}>
    <h3>控え（履歴）</h3>
    <p>自動で残る過去の状態です。新しい隊列表として開くと、今の隊列表はそのまま残ります。</p>
    {status.historyDeferred && <p className="collab-history-warning" role="status">容量がいっぱいのため、自動で控えを残す処理を延期しています。編集内容は端末に残っています。</p>}
    {status.error?.code === 'RECOVERY_CONFIRMATION_REQUIRED' && <p className="collab-history-warning" role="status">この端末は以前の保存から復旧したため、編集の送信を保留しています。編集内容を残して、共有との再同期と確認が必要です。</p>}
    {status.error?.code === 'RECEIPT_RECLAIMED' && <p className="collab-history-warning" role="status">古い送信記録のため送信を保留しています。編集内容を残して、共有との再同期と確認が必要です。</p>}
    <div className="collab-actions">
      <button type="button" disabled={ui.busy} onClick={() => { setExpanded(true); run(() => controller.list()); }}>{expanded ? '控えの一覧を更新' : '控えを見る'}</button>
      <button type="button" disabled={ui.busy} onClick={() => { setExpanded(true); run(() => controller.manual()); }}>控えを残す</button>
    </div>
    <p className="collab-muted">控えに残るのは共有に届いている内容です。曲のファイルはこの端末で対応するものを使います。</p>
    <div ref={result} className="collab-history-result" aria-live="polite" aria-atomic="true">
      {ui.error && <p className="collab-error" role="alert">{ui.error}</p>}
      {ui.notice && <p role="status">{ui.notice}</p>}
      {ui.restore && <><p role="status"><strong>{phase === 'requesting' ? '送信を確認中' : phase === 'accepted' ? '受け付けました' : phase === 'committed' ? '共有に反映しました' : 'この端末に反映しました'}</strong>
        {phase === 'committed' && '。この端末への保存を待っています。'}
        {phase === 'accepted' && '。共有への反映を確認しています。'}
        {phase === 'requesting' && '。同じ要求で結果を確認します。'}</p>
        {!!ui.restore.differences?.length && <p className="collab-history-warning">{ui.restore.message}</p>}
      </>}
      {ui.retry && <button type="button" disabled={ui.busy} onClick={() => run(() => controller.restore())}>戻す操作の結果を確認</button>}
      {ui.busy && <p role="status">確認中…</p>}
    </div>
    {confirm && <div className="collab-history-confirm" role="group" aria-label={confirm.action === 'restore' ? '共有中の隊列表を戻す確認' : '控えを削除する確認'} ref={confirmation} tabIndex={-1}>
      <h4>{confirm.action === 'restore' ? '共有中の隊列表をこの状態に戻しますか？' : 'この控えを削除しますか？'}</h4>
      <p>{when(confirm.item)} · {description(confirm.item)}</p>
      {confirm.action === 'restore' ? <><p>全員の画面に反映されます。戻す直前の状態も自動で控えに残ります。その後に他の人が同時に編集すると、完全には一致しない場合があります。</p>
        <button className="collab-primary" type="button" disabled={ui.busy} onClick={() => run(() => controller.copy(confirm.item.id, open))}>新しい隊列表として開く</button>
      </> : <p>この控えから開いたり戻したりできなくなります。戻す処理で使われている控えは削除できません。</p>}
      <div className="collab-actions">
        <button type="button" disabled={ui.busy} onClick={() => { const selected = confirm; setConfirm(null); run(() => selected.action === 'restore' ? controller.restore(selected.item.id) : controller.remove(selected.item.id)); }}>{confirm.action === 'restore' ? '全員の隊列表を戻す' : '控えを削除する'}</button>
        <button type="button" disabled={ui.busy} onClick={() => setConfirm(null)}>キャンセル</button>
      </div>
    </div>}
    {expanded && <>
      {ui.loaded && !ui.items.length && <p>控えはまだありません。</p>}
      <ul className="collab-history-list">{ui.items.map(item => <li key={item.id} data-checkpoint-id={item.id}>
        <button className="collab-history-row" type="button" aria-expanded={selectedId === item.id} aria-controls={`checkpoint-actions-${item.id}`}
          onClick={() => setSelectedId(previous => previous === item.id ? null : item.id)}>
          <span><time dateTime={item.serverAt}>{when(item)}</time><span className="collab-history-description">{description(item)}</span></span>
          <span aria-hidden="true">{selectedId === item.id ? '▴' : '▾'}</span>
        </button>
        <div className="collab-history-item-actions" id={`checkpoint-actions-${item.id}`} hidden={selectedId !== item.id}>
          <button className="collab-primary" type="button" disabled={ui.busy} onClick={() => run(() => controller.copy(item.id, open))}>新しい隊列表として開く</button>
          <button type="button" disabled={ui.busy || ui.retry} onClick={() => setConfirm({ item, action: 'restore' })}>共有中の隊列表をこの状態に戻す</button>
          {creator && <button type="button" disabled={ui.busy} onClick={() => setConfirm({ item, action: 'delete' })}>控えを削除</button>}
        </div>
      </li>)}</ul>
      {ui.cursor && <button type="button" disabled={ui.busy} onClick={() => run(() => controller.list(true))}>控えの続きを読み込む</button>}
    </>}
  </section>;
}
