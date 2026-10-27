import { GUIDANCE_STEP_LABEL, type RunGuidance } from '../lib/guidance';

/** What a run was sent of the team's guidance, by title and version; never the text. */
export function GuidanceUsed({ guidance }: { guidance: RunGuidance }) {
  const refs = Object.keys(guidance.items);
  const stepsOf = (ref: string) =>
    (['REVIEW', 'DESIGN', 'AUDIT'] as const).filter((step) => guidance.perStep[step].includes(ref)).map((step) => GUIDANCE_STEP_LABEL[step]).join(', ');
  return (
    <div className="guidance-used">
      <h3 className="section-title">Guidance used</h3>
      {guidance.mode === 'NONE' && <p className="muted">This run was started without the team’s guidance.</p>}
      {guidance.mode !== 'NONE' && refs.length === 0 && <p className="muted">No guidance applied to this run.</p>}
      {refs.length > 0 && (
        <ul className="guidance-list">
          {refs.map((ref) => {
            const item = guidance.items[ref];
            return (
              <li key={ref}>
                {item.title} <span className="muted">(version {item.version}, about {item.tokens} tokens; {stepsOf(ref)})</span>
              </li>
            );
          })}
        </ul>
      )}
      {guidance.dropped.length > 0 && (
        <p className="muted">
          Left out: {guidance.dropped.map((entry) => `${entry.title} (${GUIDANCE_STEP_LABEL[entry.step]})`).join(', ')}, over the budget of{' '}
          {guidance.budgetTokens.toLocaleString('en')} tokens.
        </p>
      )}
    </div>
  );
}
