type ExportImportPanelProps = {
  notices: string[];
  warnings: string[];
};

export const ExportImportPanel = ({
  notices,
  warnings,
}: ExportImportPanelProps) => {
  if (notices.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <section className="status-panel" aria-live="polite">
      {notices.map((notice) => (
        <p className="notice" key={notice}>
          {notice}
        </p>
      ))}
      {warnings.map((warning) => (
        <p className="notice warning" key={warning}>
          {warning}
        </p>
      ))}
    </section>
  );
};
