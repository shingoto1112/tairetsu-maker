import type { AudioSelection } from "../platform/audioStorage";
import { useState } from "react";
import type { WaveformData } from "../utils/audioWaveform";
import type { AudioMeta, FormationFrame } from "../types";
import { Crosshair, Music, Pause, Play, Plus, Rewind, FastForward, SkipBack, SkipForward } from "lucide-react";
import { formatTime } from "../utils/time";
import { getActiveFrameAtTime } from "../utils/interpolation";
import { AudioFilePickerButton } from "./AudioFilePickerButton";
import { AudioSceneTimeline } from "./AudioSceneTimeline";
import { AudioTimeDial } from "./AudioTimeDial";
import { PanelStickyHeader } from "./PanelStickyHeader";

type AudioPanelProps = {
  audioName: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  loopEnabled: boolean;
  loopStart: number;
  loopEnd: number;
  sharedAudioNotice: boolean;
  canEditAudio?: boolean;
  cloudAudioNotice?: boolean;
  audioReadOnlyMessage?: string;
  onLoadAudio: (file: AudioSelection) => void;
  sharedSong?: Omit<AudioMeta, "id"> | null;
  deviceAudioCandidates?: AudioMeta[];
  audioReady?: boolean;
  onChangeSharedSong?: (file: AudioSelection) => void | Promise<void>;
  onChooseDeviceAudio?: (audio: AudioMeta) => void;
  onLoadAudioError?: (message: string) => void;
  onTogglePlayback: () => void;
  onSeek: (time: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onLoopChange: (patch: {
    loopEnabled?: boolean;
    loopStart?: number;
    loopEnd?: number;
  }) => void;
  /** Scenes in time order; enables the song bar and scene tools. */
  frames?: FormationFrame[];
  selectedFrameId?: string | null;
  canEditScenes?: boolean;
  audioKey?: string | null;
  waveform?: WaveformData | null;
  waveformNote?: string;
  onPausePlayback?: () => boolean;
  onResumePlayback?: () => void;
  /** Select a scene and move the playhead to it. */
  onSelectScene?: (frameId: string) => void;
  onRetimeScene?: (frameId: string, timeSec: number) => void;
  /** Adds a scene at the playhead (read at the moment of the press). */
  onAddSceneAtPlayhead?: () => void;
  onAlignSceneToPlayhead?: (frameId: string) => void;
};

export const AudioPanel = ({
  audioName,
  isPlaying,
  currentTime,
  duration,
  playbackRate,
  loopEnabled,
  loopStart,
  loopEnd,
  sharedAudioNotice,
  canEditAudio = true,
  cloudAudioNotice = false,
  audioReadOnlyMessage = "音源設定を編集するには、ownerが音源設定の編集ロックを取得してください。",
  onLoadAudio,
  sharedSong,
  deviceAudioCandidates = [],
  audioReady = true,
  onChangeSharedSong,
  onChooseDeviceAudio,
  onLoadAudioError = () => undefined,
  onTogglePlayback,
  onSeek,
  onPlaybackRateChange,
  onLoopChange,
  frames = [],
  selectedFrameId = null,
  canEditScenes = true,
  waveform,
  waveformNote,
  audioKey,
  onPausePlayback,
  onResumePlayback,
  onSelectScene,
  onRetimeScene,
  onAddSceneAtPlayhead,
  onAlignSceneToPlayhead,
}: AudioPanelProps) => {
  const [dial, setDial] = useState<"start" | "end" | null>(null);
  const knownDuration = Number.isFinite(duration) && duration > 0;
  const sceneTools = frames.length > 0 && !!onSelectScene;
  const activeFrame = sceneTools ? getActiveFrameAtTime(frames, currentTime) : undefined;
  const activeIndex = activeFrame ? frames.findIndex((frame) => frame.id === activeFrame.id) : -1;
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId) ?? null;
  const clampTime = (time: number) => Math.min(Math.max(0, time), duration > 0 ? duration : Infinity);
  const playButton = <button className="mini-button primary audio-transport__play" disabled={!audioReady} onClick={onTogglePlayback} type="button">
    {isPlaying ? <Pause size={17} /> : <Play size={17} />}
    {isPlaying ? "停止" : "再生"}
  </button>;
  return (
    <section className="panel-section audio-panel">
      <PanelStickyHeader
        title="音源"
        meta={audioName ?? "曲が読み込まれていません"}
        actions={
          <>
            {!onChangeSharedSong && <AudioFilePickerButton
              className="mini-button file-picker-inline"
              disabled={!canEditAudio}
              onError={onLoadAudioError}
              onFileSelected={onLoadAudio}
            >
              <Music size={15} />
              {audioName ? "曲を変更" : "読み込み"}
            </AudioFilePickerButton>}
            {!sceneTools && playButton}
          </>
        }
      />
      {onChangeSharedSong && <div className="shared-audio-controls">
        <p>共通曲：<strong>{sharedSong?.name ?? "未設定"}</strong>{sharedSong?.duration !== undefined ? `（${formatTime(sharedSong.duration)}）` : ""}</p>
        <AudioFilePickerButton className="mini-button file-picker-inline" disabled={!canEditAudio} onError={onLoadAudioError} onFileSelected={onChangeSharedSong}>
          曲を変更（全員に反映）
        </AudioFilePickerButton>
        <p>音源ファイルは各端末だけに保存されます。全員が同じ曲を用意してください。</p>
        <AudioFilePickerButton className="mini-button file-picker-inline" disabled={!sharedSong} onError={onLoadAudioError} onFileSelected={onLoadAudio}>
          この端末の曲ファイルを選ぶ（自分だけ）
        </AudioFilePickerButton>
        {deviceAudioCandidates.length > 0 && <label>この端末に保存済みの曲
          <select aria-label="この端末に保存済みの曲" value="" disabled={!sharedSong} onChange={event => {
            const audio = deviceAudioCandidates.find(a => a.id === event.target.value); if (audio) onChooseDeviceAudio?.(audio);
          }}>
            <option value="">選んで対応付ける</option>
            {deviceAudioCandidates.map(a => <option key={a.id} value={a.id}>{a.name} / {a.duration === undefined ? "長さ不明" : formatTime(a.duration)} / {a.size.toLocaleString()} B / {a.type} / {a.id.slice(-8)}</option>)}
          </select>
        </label>}
        <p className={`notice ${audioReady ? "muted" : "warning"}`} role="status">{audioReady ? `この端末の曲：${audioName ?? "選択済み"}` : sharedSong ? "一致する曲がないか、候補が複数あります。この端末の曲ファイルを選んでください。" : "まず共通曲を設定してください。"}</p>
      </div>}
      {!onChangeSharedSong && sharedAudioNotice && (
        <p className="notice muted">
          音源ファイルは共有されていません。同じ曲ファイルを読み込んでください。
        </p>
      )}
      {cloudAudioNotice && (
        <p className="notice muted">
          音源ファイル本体はクラウド保存しません。読み込んだ音源はこの端末での再生用です。
        </p>
      )}
      {!canEditAudio && <p className="notice warning">{audioReadOnlyMessage}</p>}
      {sceneTools ? <>
        <div className="audio-now" aria-live="off">
          <strong className="audio-now__time">{formatTime(currentTime)}<small aria-label="残り時間"> {knownDuration ? `-${formatTime(Math.max(0, duration - currentTime))}` : "—"}</small></strong>
          <span className="audio-now__scene">いまのシーン：{activeFrame ? `${activeFrame.label || "無題"}（${activeIndex + 1}/${frames.length}）` : "—"}</span>
        </div>
        <AudioSceneTimeline frames={frames} duration={duration} currentTime={currentTime} selectedFrameId={selectedFrameId}
          canEdit={canEditScenes && !!onRetimeScene} waveform={waveform} waveformNote={waveformNote}
          audioKey={audioKey} onPausePlayback={onPausePlayback} onResumePlayback={onResumePlayback}
          onSeek={onSeek} onSelectScene={onSelectScene!} onRetimeScene={(id, time) => onRetimeScene?.(id, time)} />
        <div className="audio-transport" role="group" aria-label="再生の操作">
          <button type="button" className="mini-button" disabled={activeIndex <= 0}
            onClick={() => onSelectScene!(frames[activeIndex - 1].id)} aria-label="前のシーンへ"><SkipBack size={16} /></button>
          <button type="button" className="mini-button" onClick={() => onSeek(clampTime(currentTime - 5))} aria-label="5秒戻る"><Rewind size={16} />5秒</button>
          {playButton}
          <button type="button" className="mini-button" onClick={() => onSeek(clampTime(currentTime + 5))} aria-label="5秒進む">5秒<FastForward size={16} /></button>
          <button type="button" className="mini-button" disabled={activeIndex < 0 || activeIndex >= frames.length - 1}
            onClick={() => onSelectScene!(frames[activeIndex + 1].id)} aria-label="次のシーンへ"><SkipForward size={16} /></button>
        </div>
        <section className="audio-marking" aria-label="シーンの区切り">
          <div className="audio-marking__actions">
            <button type="button" className="mini-button primary" disabled={!canEditScenes || !onAddSceneAtPlayhead || !audioReady}
              onClick={() => onAddSceneAtPlayhead?.()}><Plus size={16} />ここにシーンを追加</button>
            <button type="button" className="mini-button" disabled={!canEditScenes || !selectedFrame || !onAlignSceneToPlayhead || !audioReady}
              onClick={() => selectedFrame && onAlignSceneToPlayhead?.(selectedFrame.id)}>
              <Crosshair size={16} />{selectedFrame ? `「${selectedFrame.label || "無題"}」を今の位置に` : "選んだシーンを今の位置に"}
            </button>
          </div>
          <p className="audio-marking__help">曲を流しながら、動きが変わるところで「ここにシーンを追加」を押すと、その時刻にシーンができます。</p>
        </section>
      </> : <input
        className="seek"
        type="range"
        aria-label="再生位置"
        min="0"
        max={Math.max(duration, 0.1)}
        step="0.01"
        value={Math.min(currentTime, Math.max(duration, 0))}
        onChange={(event) => onSeek(Number(event.target.value))}
      />}
      <details className="settings-disclosure audio-settings">
        <summary>詳しい設定（再生の速さ・くり返し）</summary>
      <div className="settings-grid">
        <label>
          再生の速さ
          <select
            value={playbackRate}
            onChange={(event) => onPlaybackRateChange(Number(event.target.value))}
          >
            <option value={0.5}>0.5x</option>
            <option value={0.75}>0.75x</option>
            <option value={1}>1.0x</option>
            <option value={1.25}>1.25x</option>
          </select>
        </label>
        <label>
          くり返し
          <select
            value={String(loopEnabled)}
            onChange={(event) =>
              onLoopChange({ loopEnabled: event.target.value === "true" })
            }
          >
            <option value="false">OFF</option>
            <option value="true">ON</option>
          </select>
        </label>
        <button type="button" className="mini-button" disabled={!knownDuration} onClick={() => setDial("start")}>開始 {formatTime(loopStart)}</button>
        <button type="button" className="mini-button" disabled={!knownDuration} onClick={() => setDial("end")}>終了 {formatTime(loopEnd)}</button>
      </div>
      <p className="audio-timeline__hint">くり返し：{formatTime(loopStart)} ～ {formatTime(loopEnd)}</p>
      </details>
      {dial && knownDuration && <AudioTimeDial key={`${audioKey}:${dial}:${duration}`} label={dial === "start" ? "くり返しの開始" : "くり返しの終了"}
        edge={dial} value={dial === "start" ? loopStart : loopEnd} otherTime={dial === "start" ? loopEnd : loopStart} duration={duration}
        onCancel={() => setDial(null)} onCommit={time => { onLoopChange(dial === "start" ? { loopStart: time } : { loopEnd: time }); setDial(null); }} />}
    </section>
  );
};
