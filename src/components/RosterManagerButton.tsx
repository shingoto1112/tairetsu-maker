import { Table2 } from "lucide-react";

export const RosterManagerButton = ({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    className="mini-button roster-manager-button"
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label="全体名簿を開く"
    title={disabled ? "名簿の編集はownerのみ可能です。" : "全体名簿を開く"}
  >
    <Table2 size={15} aria-hidden="true" />
    名簿
  </button>
);
