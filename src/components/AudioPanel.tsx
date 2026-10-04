import type { AudioSelection } from "../platform/audioStorage";
import type { AudioMeta } from "../types";
import { Music, Pause, Play } from "lucide-react";
import { formatTime } from "../utils/time";
import { AudioFilePickerButton } from "./AudioFilePickerButton";
import { NumericInput } from "./NumericInput";
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
}: AudioPanelProps) => {
  return (
    <section className="panel-section audio-panel">
      <PanelStickyHeader
        title="音源"
        meta={`${audioName ?? "未読み込み"} / ${formatTime(currentTime)} / ${formatTime(duration)}`}
        actions={
          <>
            {!onChangeSharedSong && <AudioFilePickerButton
              className="mini-button file-picker-inline"
              disabled={!canEditAudio}
              onError={onLoadAudioError}
              onFileSelected={onLoadAudio}
            >
              <Music size={15} />
              読み込み
            </AudioFilePickerButton>}
            <button className="mini-button primary" disabled={!audioReady} onClick={onTogglePlayback} type="button">
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? "停止" : "再生"}
            </button>
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
      <input
        className="seek"
        type="range"
        min="0"
        max={Math.max(duration, 0.1)}
        step="0.01"
        value={Math.min(currentTime, Math.max(duration, 0))}
        onChange={(event) => onSeek(Number(event.target.value))}
      />
      <div className="settings-grid">
        <label>
          再生速度
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
          ループ
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
        <label>
          開始秒
          <NumericInput
            min={0}
            step="0.1"
            value={loopStart}
            onValueChange={(loopStart) => onLoopChange({ loopStart })}
          />
        </label>
        <label>
          終了秒
          <NumericInput
            min={0}
            step="0.1"
            value={loopEnd}
            onValueChange={(loopEnd) => onLoopChange({ loopEnd })}
          />
        </label>
      </div>
    </section>
  );
};
