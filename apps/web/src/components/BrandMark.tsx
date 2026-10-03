import { Link } from 'react-router-dom';

// The brand mark is a small slice of the result ribbon, the product's main visual motif:
// each bar is a case, and its color is that case's result.
const MARK_BARS = ['passed', 'passed', 'failed', 'passed', 'blocked'] as const;

/** Without `to` (e.g. on the sign-in screen) it renders as the brand only, not as a link. */
export function BrandMark({ to }: { to?: string }) {
  const content = (
    <>
      <span className="brand-mark" aria-hidden="true">
        {MARK_BARS.map((status, i) => (
          <span key={i} className={`brand-bar status-bg--${status}`} />
        ))}
      </span>
      <span className="brand-word">TestOps</span>
    </>
  );
  return to ? (
    <Link to={to} className="brand" aria-label="TestOps home">
      {content}
    </Link>
  ) : (
    <span className="brand">{content}</span>
  );
}
