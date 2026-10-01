import { Link } from 'react-router-dom';

// Marka işareti, ürünün ana görsel motifi olan sonuç şeridinin küçük bir kesiti:
// her çubuk bir case, rengi o case'in sonucu.
const MARK_BARS = ['passed', 'passed', 'failed', 'passed', 'blocked'] as const;

/** `to` verilmezse (ör. giriş ekranı) link değil, yalnızca marka olarak çizilir. */
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
