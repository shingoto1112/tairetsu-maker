import type { usePortraitPanelHeight } from "../hooks/usePortraitPanelHeight";

export const PanelResizeHandle = ({ control }: { control: ReturnType<typeof usePortraitPanelHeight> }) => <div className="panel-resize-controls">
  <div role="separator" aria-label="編集パネルの高さ" aria-orientation="horizontal" tabIndex={0}
    aria-valuemin={control.aria.min} aria-valuemax={control.aria.max} aria-valuenow={control.aria.value}
    aria-valuetext={`${control.aria.value}px`} className="panel-resize-handle"
    title="ドラッグ・↑↓で高さ変更、Home/Endで最小/最大、Enter・ダブルタップで既定に戻す"
    onPointerDown={control.onPointerDown} onPointerMove={control.onPointerMove} onPointerUp={control.onPointerUp}
    onPointerCancel={control.onPointerCancel} onLostPointerCapture={control.onLostPointerCapture} onKeyDown={control.onKeyDown}>
    <span aria-hidden="true" />
  </div>
  <button type="button" className="panel-resize-reset" aria-label="パネル高さを既定に戻す" title="パネル高さを既定に戻す" onClick={control.reset}>↺</button>
</div>;
