import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FlipHorizontal2,
  MousePointer2,
  Shapes,
  Users,
} from "lucide-react";
import { AlignmentAction, FormationTemplate, Member } from "../types";
import { NumericInput } from "./NumericInput";
import { PanelStickyHeader } from "./PanelStickyHeader";

type GroupToolsPanelProps = {
  members: Member[];
  selectedMemberIds: string[];
  isSelectionMode: boolean;
  spacingMeters: number;
  onSpacingChange: (spacing: number) => void;
  onToggleSelectionMode: () => void;
  onClearSelection: () => void;
  onCreateGroupFromSelection: () => void;
  onNudgeSelection: (dx: number, dy: number) => void;
  onMirrorSelection: () => void;
  onApplyTemplate: (template: FormationTemplate) => void;
  onAlignSelection: (action: AlignmentAction) => void;
};

const templateLabels: Array<{ id: FormationTemplate; label: string }> = [
  { id: "horizontal", label: "横1列" },
  { id: "vertical", label: "縦1列" },
  { id: "diagonal", label: "斜め1列" },
  { id: "v", label: "V字" },
];

export const GroupToolsPanel = ({
  members,
  selectedMemberIds,
  isSelectionMode,
  spacingMeters,
  onSpacingChange,
  onToggleSelectionMode,
  onClearSelection,
  onCreateGroupFromSelection,
  onNudgeSelection,
  onMirrorSelection,
  onApplyTemplate,
  onAlignSelection,
}: GroupToolsPanelProps) => {
  const selectedNames = selectedMemberIds
    .map((id) => members.find((member) => member.id === id)?.name)
    .filter(Boolean)
    .join("、");
  const selectedCount = selectedMemberIds.length;
  const hasSelection = selectedCount > 0;
  const canLineUp = selectedCount >= 2;
  const canDistribute = selectedCount >= 3;

  return (
    <section
      className={
        isSelectionMode
          ? "panel-section formation-tools is-selection-mode"
          : "panel-section formation-tools"
      }
    >
      <PanelStickyHeader
        title="隊列操作"
        meta={`${selectedCount}人選択`}
      />

      <div className="formation-tools__selection-row">
        <button
          className={isSelectionMode ? "mini-button primary" : "mini-button"}
          onClick={onToggleSelectionMode}
          type="button"
          aria-pressed={isSelectionMode}
        >
          <MousePointer2 size={15} />
          {isSelectionMode ? "選択モード中" : "選択モード"}
        </button>
        <button
          className="mini-button"
          onClick={onClearSelection}
          disabled={!hasSelection}
          type="button"
        >
          選択解除
        </button>
      </div>

      <p className="muted-text formation-tools__hint">
        {isSelectionMode
          ? "メンバーをタップして複数選択できます。"
          : "PCはCtrl/Cmd+クリック、iPadは選択モードで複数選択できます。"}
      </p>
      {selectedNames && (
        <p className="formation-tools__selected-names">{selectedNames}</p>
      )}

      <div className="settings-grid group-spacing">
        <label>
          隊列間隔 m
          <NumericInput
            min={0.2}
            step="0.1"
            value={spacingMeters}
            onValueChange={onSpacingChange}
          />
        </label>
      </div>

      <div className="formation-tools__section">
        <h3 className="formation-tools__section-title">整列</h3>
        <div className="formation-tools__primary-grid">
          <button
            className="formation-tools__large-button"
            onClick={() => onApplyTemplate("horizontal")}
            disabled={!canLineUp}
            type="button"
          >
            <span aria-hidden="true">•••</span>
            横1列
          </button>
          <button
            className="formation-tools__large-button"
            onClick={() => onApplyTemplate("vertical")}
            disabled={!canLineUp}
            type="button"
          >
            <span aria-hidden="true">︙</span>
            縦1列
          </button>
        </div>
      </div>

      <div className="formation-tools__section">
        <h3 className="formation-tools__section-title">移動</h3>
        <div className="formation-tools__direction-pad">
          <button
            className="formation-tools__arrow-button formation-tools__arrow-button--up"
            onClick={() => onNudgeSelection(0, -0.5)}
            disabled={!hasSelection}
            type="button"
            aria-label="奥へ移動"
            title="奥へ"
          >
            <ArrowUp size={28} />
          </button>
          <button
            className="formation-tools__arrow-button formation-tools__arrow-button--left"
            onClick={() => onNudgeSelection(-0.5, 0)}
            disabled={!hasSelection}
            type="button"
            aria-label="左へ移動"
            title="左へ"
          >
            <ArrowLeft size={28} />
          </button>
          <button
            className="formation-tools__arrow-button formation-tools__arrow-button--right"
            onClick={() => onNudgeSelection(0.5, 0)}
            disabled={!hasSelection}
            type="button"
            aria-label="右へ移動"
            title="右へ"
          >
            <ArrowRight size={28} />
          </button>
          <button
            className="formation-tools__arrow-button formation-tools__arrow-button--down"
            onClick={() => onNudgeSelection(0, 0.5)}
            disabled={!hasSelection}
            type="button"
            aria-label="客席へ移動"
            title="客席へ"
          >
            <ArrowDown size={28} />
          </button>
        </div>
      </div>

      <details className="formation-tools__advanced">
        <summary>その他の整列</summary>
        <div className="template-grid">
          <button
            className="mini-button"
            onClick={() => onAlignSelection("left")}
            disabled={!canLineUp}
            type="button"
          >
            左揃え
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("centerX")}
            disabled={!canLineUp}
            type="button"
          >
            横中央
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("right")}
            disabled={!canLineUp}
            type="button"
          >
            右揃え
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("top")}
            disabled={!canLineUp}
            type="button"
          >
            上揃え
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("centerY")}
            disabled={!canLineUp}
            type="button"
          >
            縦中央
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("bottom")}
            disabled={!canLineUp}
            type="button"
          >
            下揃え
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("distributeX")}
            disabled={!canDistribute}
            type="button"
          >
            横均等
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("distributeY")}
            disabled={!canDistribute}
            type="button"
          >
            縦均等
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("stageCenterX")}
            disabled={!hasSelection}
            type="button"
          >
            センター線
          </button>
          <button
            className="mini-button"
            onClick={() => onAlignSelection("stageCenter")}
            disabled={!hasSelection}
            type="button"
          >
            選択中心を中央へ
          </button>
          {templateLabels.map((template) => (
            <button
              key={template.id}
              className="mini-button"
              onClick={() => onApplyTemplate(template.id)}
              disabled={!canLineUp}
              type="button"
            >
              <Shapes size={15} />
              {template.label}
            </button>
          ))}
        </div>

        <div className="card-actions wrap">
          <button
            className="mini-button"
            onClick={onMirrorSelection}
            disabled={!hasSelection}
            type="button"
          >
            <FlipHorizontal2 size={15} />
            センター左右反転
          </button>
          <button
            className="mini-button"
            onClick={onCreateGroupFromSelection}
            disabled={!hasSelection}
            type="button"
          >
            <Users size={15} />
            選択メンバーからグループ作成
          </button>
        </div>
      </details>
    </section>
  );
};
