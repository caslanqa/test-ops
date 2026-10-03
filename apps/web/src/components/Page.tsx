import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/** The page's single h1, its short description and the primary actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-heading">
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
        {meta}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Empty list: says what it is and what the next step is. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={28} aria-hidden="true" className="empty-icon" />
      <h2 className="empty-title">{title}</h2>
      {children && <p className="empty-text">{children}</p>}
      {action}
    </div>
  );
}

/** Load error: shows what failed and how to try again. */
export function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="load-error" role="alert">
      <p>Couldn't load data: {message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      {label}
    </p>
  );
}

/** Form error: shown below the fields and announced to screen readers immediately. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="form-error" role="alert">
      {message}
    </p>
  );
}
