export function RuntimeMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="runtime-metric">
      <span>{label}</span>
      <strong title={String(value)}>{value}</strong>
    </div>
  );
}
