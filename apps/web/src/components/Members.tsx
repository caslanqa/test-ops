import { useState } from 'react';
import { UserMinus } from 'lucide-react';
import { Dialog } from './Dialog';
import { FormError } from './Page';

export interface MemberRow {
  id: string;
  role: string;
  user: { id: string; email: string; displayName: string };
}

export interface RoleOption {
  value: string;
  label: string;
  description: string;
}

/** Role picker: a described radio group, so what each role can do is visible while choosing. */
export function RoleRadioGroup({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: string;
  options: RoleOption[];
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="role-options">
      <legend className="field-label">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className="role-option">
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>
            <span className="role-option-label">{option.label}</span>
            <span className="role-option-description">{option.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Shared table for workspace and project members. Without manage permission, roles are
 * shown as text; with it, inline role selection and the remove action are enabled.
 */
export function MemberTable({
  members,
  roleOptions,
  canManage,
  currentUserId,
  onRoleChange,
  onRemove,
  caption,
}: {
  members: MemberRow[];
  roleOptions: RoleOption[];
  canManage: boolean;
  currentUserId: string | undefined;
  onRoleChange: (member: MemberRow, role: string) => Promise<void>;
  onRemove: (member: MemberRow) => void;
  caption: string;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const labelOfRole = (role: string) => roleOptions.find((o) => o.value === role)?.label ?? role;

  async function changeRole(member: MemberRow, role: string) {
    setPendingId(member.id);
    setError(null);
    try {
      await onRoleChange(member, role);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the role");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      <FormError message={error} />
      <div className="surface table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="col-main">Member</th>
              <th scope="col">Role</th>
              {canManage && (
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              )}
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const isSelf = member.user.id === currentUserId;
              return (
                <tr key={member.id}>
                  <td>
                    <span className="member">
                      <span className="avatar avatar--light" aria-hidden="true">
                        {member.user.displayName.slice(0, 1).toLocaleUpperCase()}
                      </span>
                      <span className="member-text">
                        <span className="cell-title">
                          {member.user.displayName}
                          {isSelf && <span className="muted"> (you)</span>}
                        </span>
                        <span className="cell-sub">{member.user.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>
                    {canManage ? (
                      <select
                        className="inline-select"
                        aria-label={`Role for ${member.user.displayName}`}
                        value={member.role}
                        disabled={pendingId === member.id}
                        onChange={(e) => changeRole(member, e.target.value)}
                      >
                        {roleOptions.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    ) : (
                      labelOfRole(member.role)
                    )}
                  </td>
                  {canManage && (
                    <td className="cell-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onRemove(member)}
                        aria-label={`Remove ${member.user.displayName}`}
                      >
                        <UserMinus size={14} aria-hidden="true" />
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Confirmation for irreversible actions: says what will happen and repeats the action name on the button. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title} description={message}>
      <ConfirmBody confirmLabel={confirmLabel} onConfirm={onConfirm} onClose={onClose} />
    </Dialog>
  );
}

function ConfirmBody({
  confirmLabel,
  onConfirm,
  onClose,
}: {
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't complete the action");
      setBusy(false);
    }
  }

  return (
    <div className="dialog-body">
      <FormError message={error} />
      <div className="dialog-footer">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
