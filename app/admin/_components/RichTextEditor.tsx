'use client';

import { useEffect, useRef } from 'react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

const TOOLBAR_BUTTONS: { command: string; label: string; icon: string; iconClassName?: string }[] = [
  { command: 'bold', label: 'Bold', icon: 'B', iconClassName: 'font-bold' },
  { command: 'italic', label: 'Italic', icon: 'I', iconClassName: 'italic' },
  { command: 'underline', label: 'Underline', icon: 'U', iconClassName: 'underline' },
  { command: 'insertUnorderedList', label: 'Bullet list', icon: '•' },
];

// Deliberately not a full rich-text framework — this is a small toolbar
// (bold/italic/underline/list/link) built on the browser's native
// contentEditable + execCommand, so admin footer text doesn't need to pull
// in a WYSIWYG library dependency for what's a couple of lines of styling.
export default function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Only syncs from `value` when it changes externally (e.g. the saved
  // settings finish loading) — never on every keystroke, since resetting
  // innerHTML on every input would throw the cursor back to the start.
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      editorRef.current.innerHTML = value || '';
    }
  }, [value]);

  function emitChange() {
    onChange(editorRef.current?.innerHTML ?? '');
  }

  function exec(command: string) {
    editorRef.current?.focus();
    document.execCommand(command, false);
    emitChange();
  }

  function handleLink() {
    const url = window.prompt('Link URL:');
    if (!url) return;
    editorRef.current?.focus();
    document.execCommand('createLink', false, url);
    emitChange();
  }

  return (
    <div className="rounded-xl border border-slate-300 overflow-hidden">
      <div className="flex items-center gap-1 border-b border-slate-200 bg-slate-50 px-2 py-1.5">
        {TOOLBAR_BUTTONS.map((btn) => (
          <button
            key={btn.command}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(btn.command)}
            title={btn.label}
            className={`rounded px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-200 ${btn.iconClassName ?? ''}`}
          >
            {btn.icon}
          </button>
        ))}
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleLink}
          title="Insert link"
          className="rounded px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-200"
        >
          Link
        </button>
      </div>
      <div
        ref={editorRef}
        contentEditable
        onInput={emitChange}
        onBlur={emitChange}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        className="min-h-[90px] px-3 py-2.5 text-sm focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400"
      />
    </div>
  );
}
