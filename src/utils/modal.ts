/** Checked at event time so lazy and nested dialogs also suspend background shortcuts. */
export const isModalOpen = (): boolean =>
  typeof document !== "undefined" && document.querySelector('[aria-modal="true"]') !== null;
