/**
 * GeneratePromptModal.jsx — Code Ground AI Generate prompt entry
 * (Phase 6.5 — AI Code Generation)
 *
 * Generate is the one AI action driven primarily by a typed
 * instruction rather than a fixed template (Explain/Review/Refactor
 * just act on whatever the Editor Context layer hands them). This
 * modal's only job is collecting that instruction before the request
 * is sent — it does NOT talk to the AI itself, does NOT render the
 * response, and is NOT a second chat surface. Submitting closes the
 * modal and hands the typed text to the caller (Editor.jsx), which
 * sends it through the same useAI.generateCode() → AI Chat panel path
 * every other action already uses.
 *
 * Visually a small centered dialog (backdrop + Escape-to-close, same
 * conventions as SnapshotDrawer.jsx), not another panel.
 */
import React, { useState, useRef, useEffect } from 'react';
import styles from './GeneratePromptModal.module.css';

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const GenerateIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2z" />
    <path d="M19 15l.9 2.7L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.3z" />
  </svg>
);

/* Example prompts from the Phase 6.5 spec — same "suggestion chip"
   pattern AIChatPanel's empty state already uses, so Generate feels
   consistent with the rest of the AI surface rather than inventing a
   new interaction. */
const EXAMPLES = [
  'Generate a JWT authentication middleware',
  'Generate unit tests for this file',
  'Generate a React component',
  'Generate API documentation',
  'Generate validation logic',
];

export default function GeneratePromptModal({
  open,
  onClose,
  onSubmit,
  hasSelection = false,
  fileName     = '',
}) {
  const [value, setValue] = useState('');
  const [validationError, setValidationError] = useState('');
  const textareaRef = useRef(null);

  /* Reset on every open so a previous prompt/error never leaks into
     the next invocation. */
  useEffect(() => {
    if (open) {
      setValue('');
      setValidationError('');
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  function handleSubmit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setValidationError('Describe what you want generated before sending this to the AI.');
      textareaRef.current?.focus();
      return;
    }
    onSubmit(trimmed);
  }

  function handleChange(e) {
    setValue(e.target.value);
    if (validationError) setValidationError('');
  }

  const contextHint = hasSelection
    ? 'Using your selected code as context'
    : fileName
      ? `Using the current file (${fileName}) as context`
      : 'No file open — this will use no code context';

  return (
    <div className={styles.backdrop} onClick={onClose} aria-hidden="true">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-modal-title"
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 id="generate-modal-title" className={styles.title}>
            <GenerateIcon />
            Generate code
          </h2>
          <button
            className={styles.close_btn}
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <p className={styles.context_hint}>{contextHint}</p>

        <form onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={value}
            onChange={handleChange}
            placeholder="Describe what to generate — e.g. “Generate a JWT authentication middleware”"
            rows={4}
            maxLength={4000}
            aria-label="Generation instruction"
            aria-invalid={!!validationError}
            aria-describedby={validationError ? 'generate-modal-error' : undefined}
          />

          {validationError && (
            <p id="generate-modal-error" className={styles.error_text} role="alert">
              {validationError}
            </p>
          )}

          <div className={styles.examples} role="list" aria-label="Example prompts">
            {EXAMPLES.map(ex => (
              <button
                key={ex}
                type="button"
                role="listitem"
                className={styles.example_chip}
                onClick={() => { setValue(ex); setValidationError(''); textareaRef.current?.focus(); }}
              >
                {ex}
              </button>
            ))}
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.cancel_btn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.submit_btn} disabled={!value.trim()}>
              <GenerateIcon />
              Generate
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
