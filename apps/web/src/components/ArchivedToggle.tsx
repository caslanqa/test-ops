/** Shows archived records in a list too, so they can be found and restored. */
export function ArchivedToggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="archived-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      Show archived
    </label>
  );
}
