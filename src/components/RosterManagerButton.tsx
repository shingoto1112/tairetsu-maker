import { Table2 } from "lucide-react";

export const RosterManagerButton = ({
  onClick,
  disabled = false,
}: {
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    className="panel-action roster-manager-button"
    type="button"
    onClick={(event) => {
      // Safari does not always focus clicked buttons; useModalFocus restores this trigger.
      event.currentTarget.focus({ preventScroll: true });
      onClick();
    }}
    disabled={disabled}
    aria-label="全体名簿を開く"
    aria-haspopup="dialog"
    title={disabled ? "名簿の編集はownerのみ可能です。" : "全体名簿を開く"}
  >
    <Table2 size={18} aria-hidden="true" />
    <span>名簿</span>
  </button>
);
