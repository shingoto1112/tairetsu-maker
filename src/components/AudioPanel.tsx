import { Music, Pause, Play } from "lucide-react";
import { ChangeEvent } from "react";
import { formatTime } from "../utils/time";
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
  onLoadAudio: (file: File) => void;
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
  onLoadAudio,
  onTogglePlayback,
  onSeek,
  onPlaybackRateChange,
  onLoopChange,
}: AudioPanelProps) => {
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onLoadAudio(file);
      event.target.value = "";
    }
  };

  return (
    <section className="panel-section audio-panel">
      <PanelStickyHeader
        title="音源"
        meta={`${audioName ?? "未読み込み"} / ${formatTime(currentTime)} / ${formatTime(duration)}`}
        actions={
          <>
            <label className="mini-button file-picker-inline">
              <input type="file" accept="audio/*,.mp3,.wav,.m4a" onChange={handleFile} />
              <Music size={15} />
              読み込み
            </label>
            <button className="mini-button primary" onClick={onTogglePlayback} type="button">
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
              {isPlaying ? "停止" : "再生"}
            </button>
          </>
        }
      />
      {sharedAudioNotice && (
        <p className="notice muted">
          音源ファイルは共有されていません。同じ曲ファイルを読み込んでください。
        </p>
      )}
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
