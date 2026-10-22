import type { ReactNode } from "react";
import type { ViewerPerspective } from "../types";
import { Maximize2, Minimize2, Pause, Play, Redo2, Save, Undo2 } from "lucide-react";
import { StageTimeBar } from "./StageTimeBar";
import { StageMoreMenu } from "./StageMoreMenu";

type Props = {
  annotationControls?: ReactNode;
  currentTime: number; duration: number; audioName: string | null; sceneLabel: string;
  isPlaying: boolean; isFullscreen: boolean; isReadOnly: boolean;
  canUndo: boolean; canRedo: boolean; zoom: number; pinchLocked: boolean;
  viewerPerspective: ViewerPerspective;
  onUndo: () => void; onRedo: () => void; onPlay: () => void; onSaveProject: () => void; saveDisabled: boolean;
  onSeek: (time: number) => void; onZoom: (zoom: number) => void;
  onCapture: () => void; onPerspective: () => void; onFullscreen: () => void; onPinchLock: () => void;
};

export const CompactStageControls = (props: Props) => {
  const canSeek = Boolean(props.audioName) && Number.isFinite(props.duration) && props.duration > 0;
  return <div className="stage-export-header stage-export-header--compact">
    <div className="stage-primary-controls">
      <button className="mini-button icon-only" type="button" aria-label="元に戻す" title="元に戻す"
        disabled={!props.canUndo || props.isReadOnly} onClick={props.onUndo}><Undo2 size={18} /></button>
      <button className="mini-button icon-only" type="button" aria-label="やり直し" title="やり直し"
        disabled={!props.canRedo || props.isReadOnly} onClick={props.onRedo}><Redo2 size={18} /></button>
      <button className="stage-play-button" type="button" aria-label={props.isPlaying ? "停止" : "再生"}
        title={props.isPlaying ? "停止" : "再生"} onClick={props.onPlay}>{props.isPlaying ? <Pause size={20} /> : <Play size={20} />}</button>
      <StageTimeBar compact currentTime={props.currentTime} duration={props.duration} audioName={props.audioName} onSeek={props.onSeek} />
    </div>
    <div className="stage-export-header__actions">
      {props.annotationControls}
      <span className="stage-current-scene" title={props.sceneLabel}><span className="stage-current-scene__label">{props.sceneLabel}</span></span>
      {props.isReadOnly && <span className="stage-readonly-pill">閲覧中</span>}
      <button className="mini-button icon-only" type="button" aria-label="隊列表を保存" title="隊列表を保存"
        disabled={props.saveDisabled} onClick={props.onSaveProject}><Save size={18} /></button>
      <button className="mini-button stage-compact-fit" type="button" aria-label="ステージを全体表示に戻す" title={`全体表示（現在${Math.round(props.zoom * 100)}%）`}
        onClick={() => props.onZoom(1)}>全体表示</button>
      <button className="mini-button icon-only" type="button" aria-label={props.isFullscreen ? "全画面を終了" : "全画面"}
        title={props.isFullscreen ? "全画面を終了" : "全画面"} onClick={props.onFullscreen}>{props.isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
      <StageMoreMenu actions={[
        ...[-10, -5, 5, 10].map((delta) => ({ label: `${Math.abs(delta)}秒${delta < 0 ? "戻る" : "進む"}`, disabled: !canSeek,
          onClick: () => props.onSeek(Math.min(props.duration, Math.max(0, props.currentTime + delta))) })),
        { label: "ステージを画像保存", onClick: props.onCapture },
        { label: "ピンチ拡大縮小をロック", onClick: props.onPinchLock, pressed: props.pinchLocked },
        { label: `視点を切り替え（現在：${props.viewerPerspective === "performer" ? "踊る人側" : "観客側"}）`, onClick: props.onPerspective },
      ]} />
    </div>
  </div>;
};
