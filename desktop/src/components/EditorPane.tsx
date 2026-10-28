interface EditorPaneProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
}

export function EditorPane({ id, label, value, placeholder, readOnly = false, onChange }: EditorPaneProps) {
  return (
    <section className="editor-panel" aria-labelledby={`${id}-label`}>
      <header className="editor-header">
        <span id={`${id}-label`}>{label}</span>
        <span className="editor-state">{readOnly ? 'Processed output' : 'Raw text'}</span>
      </header>
      <textarea
        id={id}
        className="editor"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        wrap="off"
        spellCheck={false}
        aria-label={label}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </section>
  );
}
