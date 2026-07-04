type EmptyStateProps = {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function EmptyState({ icon, title, subtitle, actionLabel, onAction }: EmptyStateProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 10,
        padding: "36px 16px",
      }}
    >
      <div style={{ color: "var(--steel)", display: "flex" }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--chalk)", maxWidth: "26ch" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: "var(--steel)", maxWidth: "30ch", lineHeight: 1.5 }}>{subtitle}</div>}
      {actionLabel && onAction && (
        <button className="btn-primary" style={{ marginTop: 4, width: "auto", padding: "10px 22px" }} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
