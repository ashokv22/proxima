interface ToggleChipProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleChip({ label, checked, onChange }: ToggleChipProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="toggle-chip"
      data-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-mark" aria-hidden="true">{checked ? '✓' : '·'}</span>
      <span>{label}</span>
    </button>
  );
}
