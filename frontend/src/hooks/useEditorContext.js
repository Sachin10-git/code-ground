/**
 * useEditorContext.js — shared Editor Context layer (Phase 6.2)
 *
 * The single place that reads "what is the AI looking at right now"
 * out of the live Monaco editor. Every AI action (Chat, Explain,
 * Review, Refactor) calls getEditorContext() instead of re-deriving
 * selection/content/language itself — the point of Phase 6.2 is that
 * adding a new action never requires touching this file.
 *
 * Always reads the live Monaco buffer (editor.getValue()), never the
 * last-saved File.content — the product promise is that the AI sees
 * every edit, not just the last save.
 *
 * Returns { getEditorContext }. Call it at click time (not render
 * time) so it reflects whatever the user has selected/typed at that
 * exact moment.
 */
import { useCallback } from 'react';

/* Fallback language detection by file extension — the File model's
   `language` field defaults to 'plaintext' for every new file, so
   Monaco's syntax highlighting (and any AI context built from it)
   would otherwise be wrong for anything the user creates via the
   explorer. */
const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  java: 'java',
  c: 'cpp', cc: 'cpp', cpp: 'cpp', h: 'cpp', hpp: 'cpp',
  go: 'go',
  json: 'json', md: 'markdown', html: 'html', css: 'css',
};

export function resolveLanguage(file) {
  if (file?.language && file.language !== 'plaintext') return file.language;
  const ext = file?.name?.split('.').pop()?.toLowerCase();
  return EXT_LANG[ext] ?? 'plaintext';
}

/**
 * @param {Object} params
 * @param {React.RefObject} params.editorRef  - Monaco editor instance ref
 * @param {Object|null}     params.selectedFile - currently open File doc ({_id, name, language, ...})
 * @param {string}          params.projectId
 */
export function useEditorContext({ editorRef, selectedFile, projectId }) {
  const getEditorContext = useCallback(() => {
    const editor = editorRef.current;
    if (!selectedFile || !editor) return null;

    const model     = editor.getModel();
    const selection = editor.getSelection();
    const hasSelection = !!(selection && !selection.isEmpty());
    const selectedCode = hasSelection
      ? (model?.getValueInRange(selection) ?? '')
      : '';

    return {
      projectId,
      fileId:       selectedFile._id,
      fileName:     selectedFile.name,
      language:     resolveLanguage(selectedFile),
      fileContent:  editor.getValue(),
      selectedCode,
      hasSelection,
    };
  }, [editorRef, selectedFile, projectId]);

  return { getEditorContext };
}

export default useEditorContext;
