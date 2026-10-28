import { GridEmphasisSettings } from "./GridEmphasisSettings";
import { HorizontalCountingCards } from "./HorizontalCountingCards";
import { MemberDiameterPicker } from "./MemberDiameterPicker";
import { applyMemberDiameterAction } from "../utils/memberDiameter";
import { toHorizontalCountingMode, toParadeHorizontalMeasureMode } from "../utils/horizontalRuler";
import {
  FormationMode,
  ParadeSettings,
  StageConfig,
} from "../types";
import {
  getSafeParadeBackwardDistance,
  normalizeParadeHorizontalMeasureMode,
} from "../utils/parade";
import { NumericInput } from "./NumericInput";
import { PanelStickyHeader } from "./PanelStickyHeader";

export type StageSettingsChange = Partial<StageConfig> | ((stage: StageConfig) => Partial<StageConfig>);

type StageSettingsPanelProps = {
  mode?: FormationMode;
  stage: StageConfig;
  paradeSettings?: ParadeSettings;
  useGlobalStageSize: boolean;
  showMeterRulers?: boolean;
  showSnapGuides?: boolean;
  snapToGuides?: boolean;
  disabled?: boolean;
  disabledMessage?: string;
  onChange: (patch: StageSettingsChange) => void;
  memberDiameterDisabled?: boolean;
  onParadeSettingsChange?: (patch: Partial<ParadeSettings>) => void;
  onUseGlobalStageSizeChange: (enabled: boolean) => void;
  onToggleMeterRulers?: () => void;
  onToggleSnapGuides?: () => void;
  onToggleSnapToGuides?: () => void;
};

export const StageSettingsPanel = ({
  mode = "stage",
  stage,
  paradeSettings,
  useGlobalStageSize,
  showMeterRulers = true,
  showSnapGuides = true,
  snapToGuides = false,
  disabled = false,
  disabledMessage,
  memberDiameterDisabled = false,
  onChange,
  onParadeSettingsChange,
  onUseGlobalStageSizeChange,
  onToggleMeterRulers,
  onToggleSnapGuides,
  onToggleSnapToGuides,
}: StageSettingsPanelProps) => {
  const effectiveParadeSettings: ParadeSettings = {
    ...paradeSettings,
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
  const readOnlyNotice =
    disabledMessage ??
    "クラウドプロジェクトの全体設定は初期実装では編集できません。ローカルへ複製すると編集できます。";
  const diameterPicker = <MemberDiameterPicker value={stage.memberDiameterMeters ?? 0.5}
    disabled={disabled || memberDiameterDisabled}
    onChange={action => onChange(latest => ({
      memberDiameterMeters: applyMemberDiameterAction(latest.memberDiameterMeters ?? 0.5, action),
    }))} />;
  const displaySettings = (
    <div className="stage-display-settings">
      <h3>表示設定</h3>
      <div className="toggle-list">
        {mode === "stage" && (
          <>
            <label>
              <input
                type="checkbox"
                checked={stage.showGrid}
                disabled={disabled}
                onChange={(event) => onChange({ showGrid: event.target.checked })}
              />
              グリッド表示
            </label>
            <label>
              <input
                type="checkbox"
                checked={stage.showCenterLine ?? true}
                disabled={disabled}
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
                disabled={disabled}
                onChange={(event) =>
                  onChange({ showCenterMarker: event.target.checked })
                }
              />
              センターマーカー表示
            </label>
            <label>
              <input
                type="checkbox"
                checked={showMeterRulers}
                onChange={onToggleMeterRulers}
              />
              メートル目盛り
            </label>
            <label>
              <input
                type="checkbox"
                checked={showSnapGuides}
                disabled={disabled}
                onChange={onToggleSnapGuides}
              />
              ガイド線
            </label>
            <label>
              <input
                type="checkbox"
                checked={snapToGuides}
                disabled={disabled}
                onChange={onToggleSnapToGuides}
              />
              ガイド吸着
            </label>
          </>
        )}
      </div>
    </div>
  );

  if (mode === "parade") {
    return (
      <section className="panel-section stage-settings-panel">
        <PanelStickyHeader
          title="パレード設定"
          meta={`現在: 全体距離${effectiveParadeSettings.totalDistance}m / 後方${effectiveParadeSettings.backwardDistanceMeters ?? 0}m / 横幅${effectiveParadeSettings.width}m`}
        />
        <div className="settings-grid">
          <label>
            全体距離（m）
            <NumericInput
              min={1}
              step="1"
              disabled={disabled}
              value={effectiveParadeSettings.totalDistance}
              onValueChange={(totalDistance) =>
                onParadeSettingsChange?.({
                  totalDistance,
                })
              }
            />
          </label>
          <label>
            後方表示距離（m）
            <NumericInput
              min={0}
              step="1"
              disabled={disabled}
              value={effectiveParadeSettings.backwardDistanceMeters ?? 0}
              onValueChange={(backwardDistanceMeters) =>
                onParadeSettingsChange?.({
                  backwardDistanceMeters,
                })
              }
            />
          </label>
          <label>
            横幅（m）
            <NumericInput
              min={1}
              step="0.5"
              disabled={disabled}
              value={effectiveParadeSettings.width}
              onValueChange={(width) =>
                onParadeSettingsChange?.({
                  width,
                })
              }
            />
          </label>
          <label>
            1マスあたりの距離（m）
            <NumericInput
              min={0.1}
              step="0.1"
              disabled={disabled}
              value={effectiveParadeSettings.cellSizeMeters}
              onValueChange={(cellSizeMeters) =>
                onParadeSettingsChange?.({
                  cellSizeMeters,
                })
              }
            />
          </label>
          <HorizontalCountingCards compact disabled={disabled}
            value={toHorizontalCountingMode(effectiveParadeSettings.horizontalMeasureMode)}
            onChange={(value) => onParadeSettingsChange?.({ horizontalMeasureMode: toParadeHorizontalMeasureMode(value) })} />
          {diameterPicker}
          <label>
            距離目盛り
            <select
              value={effectiveParadeSettings.rulerPosition}
              disabled={disabled}
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
        <details className="settings-disclosure" open><summary>詳しい設定</summary>
          <GridEmphasisSettings stage={stage} parade={effectiveParadeSettings} disabled={disabled}
            onStageChange={onChange} onParadeChange={onParadeSettingsChange} />
        </details>
        {displaySettings}
        {disabled && <p className="notice warning">{readOnlyNotice}</p>}
        <p className="notice muted">
          後方表示距離を増やすと、0mラインより後ろに -1m、-2m... の範囲を追加できます。横の数え方を切り替えても、配置済みの位置は動きません。
        </p>
      </section>
    );
  }

  return (
    <section className="panel-section stage-settings-panel">
      <PanelStickyHeader
        title="ステージ設定"
        meta={useGlobalStageSize
          ? `現在: 全シーン共通 横${stage.widthMeters}m × 縦${stage.depthMeters}m`
          : `シーン別サイズを使用／基準：横${stage.widthMeters}m × 縦${stage.depthMeters}m`}
      />
    <label className="stage-size-toggle">
      <input type="checkbox" checked={useGlobalStageSize} disabled={disabled}
        onChange={(event) => onUseGlobalStageSizeChange(event.target.checked)} />
      <span>全シーンで<wbr />同じ<wbr />大きさにする</span>
    </label>
    {!useGlobalStageSize && <p className="notice muted">
      シーンごとの大きさが未設定のシーンで使います。各シーンの大きさはシーンの詳細で変えられます。
    </p>}
    <div className="settings-grid">
      <label>
        {useGlobalStageSize ? "ステージの横幅（m）" : "基準の横幅（m）"}
        <NumericInput
          min={1}
          step="0.5"
          disabled={disabled}
          value={stage.widthMeters}
          onValueChange={(widthMeters) => onChange({ widthMeters })}
        />
      </label>
      <label>
        {useGlobalStageSize ? "ステージの縦幅（m）" : "基準の縦幅（m）"}
        <NumericInput
          min={1}
          step="0.5"
          disabled={disabled}
          value={stage.depthMeters}
          onValueChange={(depthMeters) => onChange({ depthMeters })}
        />
      </label>
      <label>
        グリッド間隔（m）
        <NumericInput
          min={0.1}
          step="0.1"
          disabled={disabled}
          value={stage.gridSizeMeters}
          onValueChange={(gridSizeMeters) => onChange({ gridSizeMeters })}
        />
      </label>
      <HorizontalCountingCards compact disabled={disabled} value={stage.horizontalGuideMode ?? "meters"}
        onChange={(horizontalGuideMode) => onChange({ horizontalGuideMode })} />
      {diameterPicker}
    </div>
    <details className="settings-disclosure" open>
      <summary>詳しい設定</summary>
      <GridEmphasisSettings stage={stage} disabled={disabled} onStageChange={onChange} />
    </details>
    {displaySettings}
    {disabled && <p className="notice warning">{readOnlyNotice}</p>}
    </section>
  );
};
