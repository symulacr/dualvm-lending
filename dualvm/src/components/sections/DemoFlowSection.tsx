interface DemoFlowSectionProps {
  judgeFlow: readonly string[];
}

export function DemoFlowSection({ judgeFlow }: DemoFlowSectionProps) {
  return (
    <article className="panel-card">
      <div className="section-header">
        <h2>Judge-facing demo flow</h2>
      </div>
      <ol className="ordered-list">
        {judgeFlow.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </article>
  );
}
