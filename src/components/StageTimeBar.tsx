import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { CSSProperties } from "react";
import { formatTime } from "../utils/time";

type StageTimeBarProps = {
  compact?: boolean;
  currentTime: number;
  duration: number;
  audioName: string | null;
  onSeek: (timeSec: number) => void;
};

const formatDuration = (duration: number): string =>
  Number.isFinite(duration) && duration > 0 ? formatTime(duration) : "--:--";

export const StageTimeBar = ({
  compact = false,
  currentTime,
  duration,
  audioName,
  onSeek,
}: StageTimeBarProps) => {
  const hasAudio = Boolean(audioName);
  const canSeek = hasAudio && Number.isFinite(duration) && duration > 0;
  const safeDuration = canSeek ? duration : 0;
  const safeCurrentTime = Math.min(
    Math.max(0, currentTime),
    safeDuration || Math.max(0, currentTime),
  );
  const visualCurrentTime =
    canSeek && safeDuration > 0 && formatTime(safeCurrentTime) === formatTime(safeDuration)
      ? safeDuration
      : safeCurrentTime;
  const progressPercent =
    canSeek && safeDuration > 0
      ? Math.min(100, Math.max(0, (visualCurrentTime / safeDuration) * 100))
      : 0;
  const rangeStyle = { "--progress": `${progressPercent}%` } as CSSProperties;
  const seekBy = (deltaSec: number) => {
    if (!canSeek) return;
    onSeek(Math.min(safeDuration, Math.max(0, safeCurrentTime + deltaSec)));
  };

  return (
    <div className={canSeek ? "stage-timebar" : "stage-timebar is-disabled"}>
      {!compact && <div className="stage-timebar__skips" aria-label="再生位置のスキップ">
        <button
          className="stage-timebar__skip"
          type="button"
          onClick={() => seekBy(-10)}
          disabled={!canSeek}
          title="10秒戻る"
        >
          <ChevronsLeft size={14} />
          <span className="stage-timebar__skip-value">10</span>
        </button>
        <button
          className="stage-timebar__skip"
          type="button"
          onClick={() => seekBy(-5)}
          disabled={!canSeek}
          title="5秒戻る"
        >
          <ChevronLeft size={14} />
          <span className="stage-timebar__skip-value">5</span>
        </button>
        <button
          className="stage-timebar__skip"
          type="button"
          onClick={() => seekBy(5)}
          disabled={!canSeek}
          title="5秒進む"
        >
          <span className="stage-timebar__skip-value">5</span>
          <ChevronRight size={14} />
        </button>
        <button
          className="stage-timebar__skip"
          type="button"
          onClick={() => seekBy(10)}
          disabled={!canSeek}
          title="10秒進む"
        >
          <span className="stage-timebar__skip-value">10</span>
          <ChevronsRight size={14} />
        </button>
      </div>}
      <span className="stage-timebar__time">
        {formatTime(safeCurrentTime)} / {formatDuration(duration)}
      </span>
      <div className="stage-timebar__range-shell" style={rangeStyle}>
        <span className="stage-timebar__range-track" aria-hidden="true">
          <span className="stage-timebar__range-fill" />
        </span>
        <span className="stage-timebar__range-thumb" aria-hidden="true" />
        <input
          className="stage-timebar__range"
          type="range"
          min="0"
          max={Math.max(duration, 0.1)}
          step="0.01"
          value={canSeek ? safeCurrentTime : 0}
          disabled={!canSeek}
          onChange={(event) => onSeek(Number(event.target.value))}
          aria-label="曲の再生位置"
        />
      </div>
    </div>
  );
};
