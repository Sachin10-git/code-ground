/**
 * useRemoteCursors.js — Monaco rendering layer for remote collaborator
 * cursors: caret, selection highlight, floating username badge, and a
 * typing-in-progress indicator on both.
 *
 * Strictly a rendering concern. Takes the already-synchronized `cursors`
 * and `typingSocketIds` state (from useYjs — position/selection and
 * "who's actively typing" per socketId, kept fresh over the existing
 * Socket.IO channels) and turns it into Monaco view objects. Does not
 * touch: sockets, event names, Yjs, MonacoBinding, persistence, or the
 * emit side of cursor sync (that stays in Editor.jsx, next to the
 * Ctrl+S binding it mirrors — see onDidChangeCursorSelection in
 * handleEditorMount). The typing signal itself is nothing new either —
 * editor:typing-start/stop and editor:user-typing/stopped-typing
 * already existed for the Presence chips; this hook just reads the
 * same already-synchronized `typingSocketIds` Set and attributes it to
 * one specific cursor instead of "someone, somewhere" (see useYjs.js).
 *
 * Two Monaco mechanisms, one job each:
 *
 *   - model.deltaDecorations — the caret and the selection highlight.
 *     Both are marks AT a precise text position/range, which is what
 *     decorations are for. Inherently model-scoped, so Monaco hides
 *     them automatically when a different model is shown; ids are
 *     still tracked per fileId here (decorationsByFileRef) so a given
 *     file's own set can be diffed/cleared independently of any other
 *     open file's.
 *
 *   - editor.addContentWidget — the floating username badge. A UI
 *     overlay that needs to float ABOVE the line rather than sit
 *     inline in the text flow, which is what Monaco's
 *     ContentWidgetPositionPreference.ABOVE is for. Unlike decorations,
 *     widgets are editor-scoped, not model-scoped — Monaco will NOT
 *     hide them on a file switch, so callers must invoke
 *     `prepareFileSwitch` before swapping the editor's model.
 *
 * Never touches the document model's text: no inserted characters, no
 * hidden markers, no effect on undo history — everything here is
 * Monaco's own view layer (decorations + content widgets), the same
 * category of API y-monaco itself uses for rendering Yjs Awareness
 * cursors, just driven by plain Socket.IO state instead of CRDT
 * awareness, per this project's "no CRDT for cursors" design.
 *
 * Widgets and decorations are reused across updates (mutated in place,
 * not removed/recreated), which is both what makes the badge glide via
 * CSS transition instead of jumping, and what keeps this cheap at
 * scale — one deltaDecorations call per update covering every visible
 * collaborator, not one call per collaborator.
 */

import { useEffect, useRef, useCallback } from 'react';
import { collaboratorColorIndex } from '../utils/collaboratorColor.js';
import styles from './useRemoteCursors.module.css';

/* Badge className is rebuilt in three places (create / color change /
   typing change) — kept as one small helper so all three stay in sync. */
function badgeClassName(colorIdx, isTyping) {
  const classes = [styles.badge, styles[`badge_${colorIdx}`]];
  if (isTyping) classes.push(styles.badge_typing);
  return classes.join(' ');
}

export function useRemoteCursors({
  editorRef, monacoRef, cursors, typingSocketIds, selectedFileId, currentUserId,
}) {
  const decorationsByFileRef = useRef(new Map()); // fileId -> decoration ids
  const widgetsRef           = useRef(new Map()); // socketId -> { widget, domNode, colorIdx, label }

  const removeAllWidgets = useCallback((editor) => {
    if (!editor) return;
    widgetsRef.current.forEach(({ widget }) => editor.removeContentWidget(widget));
    widgetsRef.current.clear();
  }, []);

  /* Call before swapping the editor's model to a different file.
     Decorations are cleared on their own (outgoing) model directly —
     model.deltaDecorations works on any model, not just the one
     currently attached to the editor. Badges are removed outright
     since they don't belong to any one model; the main effect below
     recreates the right ones once the new file's own `cursors`
     arrive. */
  const prepareFileSwitch = useCallback((outgoingFileId, outgoingModel, editor) => {
    const ids = decorationsByFileRef.current.get(outgoingFileId);
    if (outgoingModel && ids?.length) {
      outgoingModel.deltaDecorations(ids, []);
    }
    decorationsByFileRef.current.delete(outgoingFileId);
    removeAllWidgets(editor);
  }, [removeAllWidgets]);

  useEffect(() => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model  = editor?.getModel();
    if (!editor || !monaco || !model || !selectedFileId) return;

    /* Keep the caret's height in sync with the editor's *actual*
       measured line height (accounting for the lineHeight multiplier
       set in Monaco's own options), rather than an approximated CSS
       value, so it spans the real line precisely. Written once per run
       as a CSS custom property on the editor's own DOM node, inherited
       by decoration content underneath it. */
    const lineHeightPx = editor.getOption(monaco.editor.EditorOption.lineHeight);
    editor.getDomNode()?.style.setProperty('--remote-cursor-line-height', `${lineHeightPx}px`);

    const entries = Object.entries(cursors)
      .filter(([, c]) => c.position && c.userId !== currentUserId); // never render our own cursor

    /* Drop badges for anyone no longer present — left the room,
       disconnected, or filtered out above. */
    const activeSocketIds = new Set(entries.map(([socketId]) => socketId));
    for (const [socketId, entry] of widgetsRef.current) {
      if (!activeSocketIds.has(socketId)) {
        editor.removeContentWidget(entry.widget);
        widgetsRef.current.delete(socketId);
      }
    }

    const decorations = [];

    for (const [socketId, { username, position, selection }] of entries) {
      const label     = username || 'Guest';
      const colorIdx  = collaboratorColorIndex(label);
      const isTyping  = typingSocketIds?.has(socketId) ?? false;
      const pos       = model.validatePosition({
        lineNumber: position.lineNumber,
        column:     position.column,
      });

      /* Selection highlight — only when there's an actual range, not
         just a caret. Selection start/end fields (from Monaco's
         Selection object, see Editor.jsx) are already normalized
         (start <= end) regardless of drag direction. */
      if (selection) {
        const start = model.validatePosition({
          lineNumber: selection.startLineNumber, column: selection.startColumn,
        });
        const end = model.validatePosition({
          lineNumber: selection.endLineNumber, column: selection.endColumn,
        });
        if (start.lineNumber !== end.lineNumber || start.column !== end.column) {
          decorations.push({
            range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column),
            options: {
              className:  styles[`selection_${colorIdx}`],
              stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            },
          });
        }
      }

      /* The caret. `content` can't be an empty string in some Monaco
         builds, so a single space is used; it's given an explicit
         fixed width in CSS so the character itself is invisible — the
         visible mark is entirely the element's own background/glow.
         While actively typing (Phase 5.5), an extra modifier class adds
         a gentle blink so the caret itself — not just the badge —
         communicates "editing right now", the way Live Share's does. */
      decorations.push({
        range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
        options: {
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          before: {
            content:         ' ',
            inlineClassName: isTyping
              ? `${styles[`caret_${colorIdx}`]} ${styles.caret_typing}`
              : styles[`caret_${colorIdx}`],
          },
        },
      });

      /* Floating username badge — a Content Widget, reused across
         updates (mutated + editor.layoutContentWidget) rather than
         removed and re-added every time, which is what lets it glide
         smoothly via the CSS transition instead of jumping: a fresh
         DOM node each update would give the transition nothing
         continuous to animate across. */
      let entry = widgetsRef.current.get(socketId);
      if (!entry) {
        const domNode = document.createElement('div');
        domNode.textContent = label;
        domNode.className = badgeClassName(colorIdx, isTyping);

        const widget = {
          _position: pos,
          allowEditorOverflow: true,
          getId: () => `remote-cursor-${socketId}`,
          getDomNode: () => domNode,
          getPosition: () => ({
            position:   widget._position,
            preference: [
              monaco.editor.ContentWidgetPositionPreference.ABOVE,
              monaco.editor.ContentWidgetPositionPreference.BELOW,
            ],
          }),
        };

        editor.addContentWidget(widget);
        entry = { widget, domNode, colorIdx, label, isTyping };
        widgetsRef.current.set(socketId, entry);
      } else {
        if (entry.label !== label) {
          entry.domNode.textContent = label;
          entry.label = label;
        }
        /* Only touch the DOM className when something it depends on has
           actually changed — this effect re-runs on every cursor move
           from anyone in the room, so a redundant class write here
           would happen far more often than the visible state changes. */
        if (entry.colorIdx !== colorIdx || entry.isTyping !== isTyping) {
          entry.domNode.className = badgeClassName(colorIdx, isTyping);
          entry.colorIdx = colorIdx;
          entry.isTyping = isTyping;
        }
        entry.widget._position = pos;
        editor.layoutContentWidget(entry.widget);
      }
    }

    const prevIds = decorationsByFileRef.current.get(selectedFileId) ?? [];
    const newIds  = model.deltaDecorations(prevIds, decorations);
    decorationsByFileRef.current.set(selectedFileId, newIds);
  }, [cursors, typingSocketIds, selectedFileId, currentUserId, editorRef, monacoRef]);

  /* Full teardown on unmount (page navigation away, project change).
     The per-file effect above only ever manages the *current* file's
     widgets, so anything belonging to whatever file was open when this
     hook unmounts needs its own sweep here — decorations don't need
     explicit cleanup (they die with their model), but widgets do. */
  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      if (editor) {
        widgetsRef.current.forEach(({ widget }) => editor.removeContentWidget(widget));
      }
      widgetsRef.current.clear();
      decorationsByFileRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { prepareFileSwitch };
}

export default useRemoteCursors;
