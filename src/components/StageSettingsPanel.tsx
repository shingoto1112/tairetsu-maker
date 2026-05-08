import {
  FormationMode,
  FrontDirection,
  HorizontalGuideMode,
  OriginMode,
  ParadeHorizontalMeasureMode,
  ParadeSettings,
  StageConfig,
} from "../types";
import {
  getSafeParadeBackwardDistance,
  normalizeParadeHorizontalMeasureMode,
} from "../utils/parade";
import { NumericInput } from "./NumericInput";
import { PanelStickyHeader } from "./PanelStickyHeader";

type StageSettingsPanelProps = {
  mode?: FormationMode;
  stage: StageConfig;
  paradeSettings?: ParadeSettings;
  useGlobalStageSize: boolean;
  onChange: (patch: Partial<StageConfig>) => void;
  onParadeSettingsChange?: (patch: Partial<ParadeSettings>) => void;
  onUseGlobalStageSizeChange: (enabled: boolean) => void;
};

export const StageSettingsPanel = ({
  mode = "stage",
  stage,
  paradeSettings,
  useGlobalStageSize,
  onChange,
  onParadeSettingsChange,
  onUseGlobalStageSizeChange,
}: StageSettingsPanelProps) => {
  const effectiveParadeSettings: ParadeSettings = {
    totalDistance: paradeSettings?.totalDistance ?? stage.depthMeters,
    backwardDistanceMeters: getSafeParadeBackwardDistance(
      paradeSettings?.backwardDistanceMeters,
    ),
    width: paradeSettings?.width ?? stage.widthMeters,
    cellSizeMeters: paradeSettings?.cellSizeMeters ?? stage.gridSizeMeters,
    direction: paradeSettings?.direction ?? "up",
    rulerPosition: paradeSettings?.rulerPosition ?? "both",
    horizontalMeasureMode: normalizeParadeHorizontalMeasureMode(
      paradeSettings?.horizontalMeasureMode,
    ),
    emphasizeEvery5m: paradeSettings?.emphasizeEvery5m ?? true,
    emphasizeEvery10m: paradeSettings?.emphasizeEvery10m ?? true,
  };

  if (mode === "parade") {
    return (
      <section className="panel-section">
        <PanelStickyHeader
          title="パレード設定"
          meta={`現在: 全体距離${effectiveParadeSettings.totalDistance}m / 0m後方${effectiveParadeSettings.backwardDistanceMeters ?? 0}m / 横幅${effectiveParadeSettings.width}m`}
        />
        <div className="settings-grid">
          <label>
            全体距離
            <NumericInput
              min={1}
              step="1"
              value={effectiveParadeSettings.totalDistance}
              onValueChange={(totalDistance) =>
                onParadeSettingsChange?.({
                  totalDistance,
                })
              }
            />
          </label>
          <label>
            0mライン後方
            <NumericInput
              min={0}
              step="1"
              value={effectiveParadeSettings.backwardDistanceMeters ?? 0}
              onValueChange={(backwardDistanceMeters) =>
                onParadeSettingsChange?.({
                  backwardDistanceMeters,
                })
              }
            />
          </label>
          <label>
            横幅
            <NumericInput
              min={1}
              step="0.5"
              value={effectiveParadeSettings.width}
              onValueChange={(width) =>
                onParadeSettingsChange?.({
                  width,
                })
              }
            />
          </label>
          <label>
            1マスあたりの距離
            <NumericInput
              min={0.1}
              step="0.1"
              value={effectiveParadeSettings.cellSizeMeters}
              onValueChange={(cellSizeMeters) =>
                onParadeSettingsChange?.({
                  cellSizeMeters,
                })
              }
            />
          </label>
          <label>
            横方向表示方式
            <select
              value={effectiveParadeSettings.horizontalMeasureMode ?? "centerSplit"}
              onChange={(event) =>
                onParadeSettingsChange?.({
                  horizontalMeasureMode: event.target
                    .value as ParadeHorizontalMeasureMode,
                })
              }
            >
              <option value="centerSplit">センター割り方式</option>
              <option value="normalMeter">通常m表示</option>
            </select>
          </label>
          <label>
            距離目盛り
            <select
              value={effectiveParadeSettings.rulerPosition}
              onChange={(event) =>
                onParadeSettingsChange?.({
                  rulerPosition: event.target.value as ParadeSettings["rulerPosition"],
                })
              }
            >
              <option value="both">左右に表示</option>
              <option value="left">左のみ表示</option>
              <option value="right">右のみ表示</option>
              <option value="none">非表示</option>
            </select>
          </label>
        </div>
        <div className="toggle-list">
          <label>
            <input
              type="checkbox"
              checked={effectiveParadeSettings.emphasizeEvery5m}
              onChange={(event) =>
                onParadeSettingsChange?.({
                  emphasizeEvery5m: event.target.checked,
                })
              }
            />
            5mごとのライン強調
          </label>
          <label>
            <input
              type="checkbox"
              checked={effectiveParadeSettings.emphasizeEvery10m}
              onChange={(event) =>
                onParadeSettingsChange?.({
                  emphasizeEvery10m: event.target.checked,
                })
              }
            />
            10mごとのライン強調
          </label>
        </div>
        <p className="notice muted">
          0mライン後方を増やすと、スタート後ろに -1m、-2m... の範囲を追加できます。横方向表示方式は表示だけを切り替えます。
        </p>
      </section>
    );
  }

  return (
    <section className="panel-section">
      <PanelStickyHeader
        title="ステージ設定"
        meta={`現在: 横${stage.widthMeters}m / 縦${stage.depthMeters}m / ${
          useGlobalStageSize ? "全シーン固定ON" : "シーン別サイズ"
        }`}
        actions={
          <label className="sticky-select-label">
            固定
            <select
              value={String(useGlobalStageSize)}
              onChange={(event) =>
                onUseGlobalStageSizeChange(event.target.value === "true")
              }
            >
              <option value="true">ON</option>
              <option value="false">OFF</option>
            </select>
          </label>
        }
      />
    <div className="settings-grid">
      <label>
        デフォルトの横
        <NumericInput
          min={1}
          step="0.5"
          value={stage.widthMeters}
          onValueChange={(widthMeters) => onChange({ widthMeters })}
        />
      </label>
      <label>
        デフォルトの縦
        <NumericInput
          min={1}
          step="0.5"
          value={stage.depthMeters}
          onValueChange={(depthMeters) => onChange({ depthMeters })}
        />
      </label>
      <label>
        グリッド間隔
        <NumericInput
          min={0.1}
          step="0.1"
          value={stage.gridSizeMeters}
          onValueChange={(gridSizeMeters) => onChange({ gridSizeMeters })}
        />
      </label>
      <label>
        横方向の表示
        <select
          value={stage.horizontalGuideMode ?? "meters"}
          onChange={(event) =>
            onChange({
              horizontalGuideMode: event.target.value as HorizontalGuideMode,
            })
          }
        >
          <option value="meters">通常メートル表示</option>
          <option value="centerSplit">センター割り表示</option>
        </select>
      </label>
      <label>
        メンバー円の直径
        <NumericInput
          min={0.2}
          max={1}
          step="0.05"
          value={stage.memberDiameterMeters ?? 0.5}
          onValueChange={(memberDiameterMeters) =>
            onChange({ memberDiameterMeters })
          }
        />
      </label>
    </div>
    <p className="notice muted">
      現在: {useGlobalStageSize ? `全シーン共通 横${stage.widthMeters}m × 縦${stage.depthMeters}m` : "シーンごとのサイズを使用"}
    </p>
    <p className="notice muted">
      {(stage.horizontalGuideMode ?? "meters") === "centerSplit"
        ? "センター割り表示: 横方向の目盛りラベルだけを中心からの番号で表示します。内部座標はmのままです。"
        : "通常メートル表示: -5m, 0m, +5m のように実寸mで表示します。"}
    </p>
    <details className="settings-disclosure">
      <summary>ステージ詳細設定</summary>
      <div className="settings-grid">
        <label>
          正面方向
          <select
            value={stage.frontDirection ?? stage.audienceSide ?? "bottom"}
            onChange={(event) => {
              const frontDirection = event.target.value as FrontDirection;
              onChange({
                frontDirection,
                audienceSide:
                  frontDirection === "top" || frontDirection === "bottom"
                    ? frontDirection
                    : stage.audienceSide,
              });
            }}
          >
            <option value="bottom">客席側が下</option>
            <option value="top">客席側が上</option>
            <option value="left">客席側が左</option>
            <option value="right">客席側が右</option>
          </select>
        </label>
        <label>
          0m基準位置
          <select
            value={stage.originMode ?? "center"}
            onChange={(event) =>
              onChange({ originMode: event.target.value as OriginMode })
            }
          >
            <option value="topLeft">左上基準</option>
            <option value="center">中央基準</option>
            <option value="audienceCenter">客席中央基準</option>
          </select>
        </label>
      </div>
      <div className="toggle-list">
        <label>
          <input
            type="checkbox"
            checked={stage.showGrid}
            onChange={(event) => onChange({ showGrid: event.target.checked })}
          />
          グリッド表示
        </label>
        <label>
          <input
            type="checkbox"
            checked={stage.showCenterLine ?? true}
            onChange={(event) =>
              onChange({ showCenterLine: event.target.checked })
            }
          />
          中央線表示
        </label>
        <label>
          <input
            type="checkbox"
            checked={stage.showCenterMarker ?? true}
            onChange={(event) =>
              onChange({ showCenterMarker: event.target.checked })
            }
          />
          センターマーカー表示
        </label>
        <label>
          <input
            type="checkbox"
            checked={stage.showStageLabels}
            onChange={(event) =>
              onChange({ showStageLabels: event.target.checked })
            }
          />
          上手 / 下手ラベル
        </label>
      </div>
    </details>
    </section>
  );
};
