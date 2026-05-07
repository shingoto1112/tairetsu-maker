import { FlipHorizontal2, Shapes, Users } from "lucide-react";
import { AlignmentAction, FormationTemplate, Member } from "../types";
import { NumericInput } from "./NumericInput";
import { PanelStickyHeader } from "./PanelStickyHeader";

type GroupToolsPanelProps = {
  members: Member[];
  selectedMemberIds: string[];
  spacingMeters: number;
  onSpacingChange: (spacing: number) => void;
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
  spacingMeters,
  onSpacingChange,
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

  return (
    <section className="panel-section formation-tools">
      <PanelStickyHeader
        title="隊列操作"
        meta={`${selectedMemberIds.length}人選択`}
      />
      <p className="muted-text">
        {selectedNames || "メンバー行のチェックで複数選択できます。"}
      </p>

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

      <div className="template-grid">
        <button
          className="mini-button"
          onClick={() => onAlignSelection("left")}
          disabled={selectedMemberIds.length < 2}
          type="button"
        >
          左揃え
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("centerX")}
          disabled={selectedMemberIds.length < 2}
          type="button"
        >
          横中央
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("right")}
          disabled={selectedMemberIds.length < 2}
          type="button"
        >
          右揃え
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("top")}
          disabled={selectedMemberIds.length < 2}
          type="button"
        >
          上揃え
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("centerY")}
          disabled={selectedMemberIds.length < 2}
          type="button"
        >
          縦中央
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("bottom")}
          disabled={selectedMemberIds.length < 2}
          type="button"
        >
          下揃え
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("distributeX")}
          disabled={selectedMemberIds.length < 3}
          type="button"
        >
          横均等
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("distributeY")}
          disabled={selectedMemberIds.length < 3}
          type="button"
        >
          縦均等
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("stageCenterX")}
          disabled={selectedMemberIds.length === 0}
          type="button"
        >
          センター線
        </button>
        <button
          className="mini-button"
          onClick={() => onAlignSelection("stageCenter")}
          disabled={selectedMemberIds.length === 0}
          type="button"
        >
          選択中心を中央へ
        </button>
        {templateLabels.map((template) => (
          <button
            key={template.id}
            className="mini-button"
            onClick={() => onApplyTemplate(template.id)}
            disabled={selectedMemberIds.length < 2}
            type="button"
          >
            <Shapes size={15} />
            {template.label}
          </button>
        ))}
      </div>

      <div className="nudge-grid">
        <button className="mini-button" onClick={() => onNudgeSelection(0, -0.5)} type="button">
          奥へ
        </button>
        <button className="mini-button" onClick={() => onNudgeSelection(-0.5, 0)} type="button">
          左へ
        </button>
        <button className="mini-button" onClick={() => onNudgeSelection(0.5, 0)} type="button">
          右へ
        </button>
        <button className="mini-button" onClick={() => onNudgeSelection(0, 0.5)} type="button">
          客席へ
        </button>
      </div>

      <div className="card-actions wrap">
        <button
          className="mini-button"
          onClick={onMirrorSelection}
          disabled={selectedMemberIds.length === 0}
          type="button"
        >
          <FlipHorizontal2 size={15} />
          センター左右反転
        </button>
        <button
          className="mini-button"
          onClick={onCreateGroupFromSelection}
          disabled={selectedMemberIds.length === 0}
          type="button"
        >
          <Users size={15} />
          選択メンバーからグループ作成
        </button>
      </div>
    </section>
  );
};
