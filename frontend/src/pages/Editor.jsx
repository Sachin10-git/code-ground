/**
 * Editor.jsx — Code Ground main workspace
 *
 * This is the core product page. Everything Code Ground does happens here.
 *
 * ── Layout (100vh, no page scroll) ─────────────────────────────────
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  TopBar (48px)  logo | title | lang | presence | run │
 *   ├────────────────────────────────────┬────────────────┤
 *   │                                    │  AI Sidebar    │
 *   │       Monaco Editor                │  (messages +   │
 *   │       (flex: 1)                    │   input)       │
 *   │                                    ├────────────────┤
 *   │                                    │  Output Panel  │
 *   │                                    │  (collapsible) │
 *   └────────────────────────────────────┴────────────────┘
 *
 * ── Real-time sync architecture ─────────────────────────────────────
 *
 *   Yjs document  ←→  Socket.io  ←→  other users
 *        ↕
 *   MonacoBinding  ←→  Monaco editor
 *        ↕
 *   Awareness  →  cursor decorations + presence chips
 *
 * ── AI context flow ─────────────────────────────────────────────────
 *
 *   User types question in AI input
 *     → POST /api/ai/ask  { question, code, language, editLog }
 *     → Backend calls Anthropic API with full session context
 *     → Response streams back via Server-Sent Events (SSE)
 *     → Tokens appended to the last message in real time
 *
 * ── Code execution flow ─────────────────────────────────────────────
 *
 *   User clicks Run
 *     → POST /api/execute  { code, language }
 *     → Backend spawns isolated Docker container
 *     → stdout / stderr returned in response
 *     → Output panel shows result, elapsed time, exit code
 *
 * ── State owned here ────────────────────────────────────────────────
 *
 *   doc          — document metadata from GET /documents/:id
 *   peers        — array of online users from Yjs awareness
 *   aiMessages   — full chat history [{role, content, streaming}]
 *   output       — last execution result {stdout, stderr, elapsed, success}
 *   outputOpen   — whether the output panel is expanded
 *   running      — true while POST /execute is in flight
 *   aiLoading    — true while the AI SSE stream is open
 *   connected    — Socket.io connection status
 *   editLog      — ring buffer of last 50 edits for AI context
 */

import React, {
  useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import MonacoEditor                     from '@monaco-editor/react';
import { useAuth }                      from '../hooks/useAuth.jsx';
import api                              from '../utils/api.js';
import styles                           from './Editor.module.css';
import AISidebar from '../components/AISidebar.jsx';
import Presence  from '../components/Presence.jsx';
import OutputPanel from '../components/OutputPanel.jsx';
import SnapshotDrawer from '../components/SnapshotDrawer.jsx';
import Navbar from '../components/Navbar.jsx';
import FileExplorer from '../components/FileExplorer.jsx';
import FilePresenceBar from '../components/FilePresenceBar.jsx';
import { useYjs } from '../hooks/useYjs.js';
import { useAI } from '../hooks/useAI.js';
import { useExecution } from '../hooks/useExecution.js';
import { useRemoteCursors } from '../hooks/useRemoteCursors.js';
import { useFilePresence } from '../hooks/useFilePresence.js';
import { useResizablePanel } from '../hooks/useResizablePanel.js';

/* ─────────────────────────────────────────────────────────────────────
   CONSTANTS
───────────────────────────────────────────────────────────────────── */

const LANG_LABEL = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python:     'Python',
  java:       'Java',
  cpp:        'C++',
  go:         'Go',
};

const LANG_COLOR = {
  javascript: '#F7DF1E',
  typescript: '#3178C6',
  python:     '#3572A5',
  java:       '#B07219',
  cpp:        '#F34B7D',
  go:         '#00ADD8',
};

const AVATAR_COLORS = [
  '#3B82F6','#22D3EE','#34D399','#F59E0B',
  '#EC4899','#8B5CF6','#F87171','#60A5FA',
];

function avatarColor(name = '') {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

/* Max edits kept in memory for AI context */
const MAX_EDIT_LOG = 50;

/* Phase 6.3.5 — resizable panel width constraints. Defaults match the
   pre-resize fixed widths (sidebar was 220px, right panel 320px via
   Editor.module.css's old --rp-width) so nobody's layout jumps on
   first load after this shipped. */
const SIDEBAR_WIDTH  = { storageKey: 'cg_sidebar_width',  defaultWidth: 220, minWidth: 160, maxWidth: 480 };
const AI_PANEL_WIDTH = { storageKey: 'cg_ai_panel_width', defaultWidth: 320, minWidth: 260, maxWidth: 560 };

/* Fallback language detection by file extension — the File model's
   `language` field defaults to 'plaintext' for every new file, so
   Monaco's syntax highlighting would otherwise be wrong for anything
   the user creates via the explorer. */
const EXT_LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python',
  java: 'java',
  c: 'cpp', cc: 'cpp', cpp: 'cpp', h: 'cpp', hpp: 'cpp',
  go: 'go',
  json: 'json', md: 'markdown', html: 'html', css: 'css',
};

function resolveLanguage(file) {
  if (file?.language && file.language !== 'plaintext') return file.language;
  const ext = file?.name?.split('.').pop()?.toLowerCase();
  return EXT_LANG[ext] ?? 'plaintext';
}

/* ─────────────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────────────── */

const PlayIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
    stroke="none" aria-hidden="true"><polygon points="5,3 19,12 5,21" /></svg>
);

const StopIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"
    stroke="none" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2" /></svg>
);

const SendIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const ChevronUpIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
);

const BackIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const BotIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 4 0v2" />
    <path d="M16 7V5a2 2 0 0 0-4 0v2" />
    <circle cx="9" cy="13" r="1" fill="currentColor" />
    <circle cx="15" cy="13" r="1" fill="currentColor" />
    <path d="M9 17h6" />
  </svg>
);

const Spinner = ({ size = 14 }) => (
  <svg className={styles.spinner} width={size} height={size}
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    aria-hidden="true">
    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
  </svg>
);



/* ─────────────────────────────────────────────────────────────────────
   EDITOR — page root
───────────────────────────────────────────────────────────────────── */
export default function Editor() {
  const { docId }  = useParams();
  const projectId  = docId; // route param name unchanged (App.jsx untouched); this id is now a real Project _id
  const { user }   = useAuth();
  const navigate   = useNavigate();

  const [doc,        setDoc]        = useState(null);
  const [docLoading, setDocLoading] = useState(true);
  const [docError,   setDocError]   = useState('');

  const [selectedFile, setSelectedFile] = useState(null);
  const selectedFileId = selectedFile?._id ?? null;

  const [dirtyFileIds, setDirtyFileIds] = useState(() => new Set());
  const [saving,        setSaving]        = useState(false);
  const [saveError,     setSaveError]     = useState('');

  /* Phase 6.1: transient notice for workspace events that affect the
     currently open file (e.g. a collaborator deleted it) — reuses the
     same inline-banner style as saveError rather than a new toast
     system. */
  const [workspaceNotice, setWorkspaceNotice] = useState('');

  // const [output,     setOutput]     = useState(null);
  // const [running,    setRunning]    = useState(false);
  // const [outputOpen, setOutputOpen] = useState(true);

  const editorRef  = useRef(null);
  const monacoRef  = useRef(null);
  const editLogRef = useRef([]);

  /* Phase 4: per-file Monaco state. One model per opened file (so
     undo history/cursor/scroll are independent per file), keyed by
     File._id — never by the Yjs/collaboration docId above. */
  const selectedFileRef = useRef(null);
  const modelsRef       = useRef(new Map()); // fileId -> monaco.editor.ITextModel
  const viewStatesRef   = useRef(new Map()); // fileId -> ICodeEditorViewState
  const savedContentRef = useRef(new Map()); // fileId -> last content persisted to the backend
  const savingRef        = useRef(false); // true while a save PATCH is in flight (guards against overlap)

  /* Phase 5: the live MonacoBinding for whichever file is currently
     open. Only ever one at a time — recreated per file in
     handleDocReady, disposed on unmount below. */
  const collabBindingRef = useRef(null);

  /* Phase 5.4: live cursor sync — the emit side only. sendCursorRef
     mirrors the handleSaveFileRef pattern below — Monaco's cursor
     listener is bound once at mount, so it needs a stable function
     that always forwards to the *current* sendCursor from useYjs
     rather than a closure captured at mount time. The receive/render
     side (decorations, floating badges) lives entirely in
     useRemoteCursors — see cursorRendering below. */
  const sendCursorRef      = useRef(() => {});
  /* Set once useRemoteCursors is called below (after useYjs) — read via
     ref rather than a direct closure so openFileInEditor's own identity
     doesn't have to change every time the hook's return value does. */
  const cursorRenderingRef = useRef(null);

  useEffect(() => { selectedFileRef.current = selectedFile; }, [selectedFile]);

  /* Dispose cached models (and the live collaboration binding) when
     the project changes or the page unmounts */
  useEffect(() => {
    return () => {
      collabBindingRef.current?.destroy();
      collabBindingRef.current = null;
      modelsRef.current.forEach(model => model.dispose());
      modelsRef.current.clear();
      viewStatesRef.current.clear();
      savedContentRef.current.clear();
      /* Remote-cursor decorations/widgets are cleaned up by
         useRemoteCursors's own unmount effect, not here. */
    };
  }, [projectId]);

  const markFileDirty = useCallback((fileId) => {
    setDirtyFileIds(prev => {
      if (prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.add(fileId);
      return next;
    });
  }, []);

  /* Track edits for AI context. Previously fed by the (broken) old
     Yjs binding; now driven directly off the per-file Monaco model's
     own content-change event (wired below in openFileInEditor). */
  const handleEditorUpdate = useCallback((text) => {
    editLogRef.current = [
      ...editLogRef.current.slice(-(MAX_EDIT_LOG - 1)),
      { username: user?.username ?? 'unknown', timestamp: new Date().toISOString(), preview: text.slice(0, 80) },
    ];
  }, [user?.username]);

  /* Called by useYjs once a file's collaboration room has applied its
     initial document sync (so the Y.Doc already reflects the file's
     real content, not an empty one) — safe to bind Monaco now without
     y-monaco's initial sync clobbering the model. */
  const handleDocReady = useCallback(async (doc, fileId) => {
    if (fileId !== selectedFileRef.current?._id) return; // stale — user already switched away

    const editor = editorRef.current;
    const model  = modelsRef.current.get(fileId);
    if (!editor || !model) return;

    collabBindingRef.current?.destroy();
    collabBindingRef.current = null;

    try {
      const { MonacoBinding } = await import('y-monaco');
      /* Re-check after the async import in case the user switched
         files again while it was loading. */
      if (fileId !== selectedFileRef.current?._id || editorRef.current !== editor) return;
      collabBindingRef.current = new MonacoBinding(
        doc.getText('editor'),
        model,
        new Set([editor]),
      );
    } catch (e) {
      console.warn('Collaborative binding unavailable:', e.message);
    }
  }, []);

  /* Loads a file's content into Monaco, creating its model on first
     open and reusing it (with saved view state) on every subsequent
     switch back to that file. */
  const openFileInEditor = useCallback((file) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !file) return;

    const prevFile = selectedFileRef.current;
    if (prevFile && prevFile._id !== file._id) {
      viewStatesRef.current.set(prevFile._id, editor.saveViewState());

      /* Remote-cursor decorations/badges belong to useRemoteCursors —
         tell it we're leaving this file so it can clear them
         immediately, before the new model is attached below. */
      cursorRenderingRef.current?.prepareFileSwitch(
        prevFile._id,
        modelsRef.current.get(prevFile._id),
        editor,
      );
    }

    let model = modelsRef.current.get(file._id);
    if (!model) {
      model = monaco.editor.createModel(
        file.content ?? '',
        resolveLanguage(file),
        monaco.Uri.parse(`inmemory://codeground/${file._id}`),
      );
      modelsRef.current.set(file._id, model);
      savedContentRef.current.set(file._id, file.content ?? '');
      model.onDidChangeContent(() => {
        markFileDirty(file._id);
        handleEditorUpdate(model.getValue());
      });
    }

    editor.setModel(model);
    const viewState = viewStatesRef.current.get(file._id);
    if (viewState) editor.restoreViewState(viewState);
    editor.focus();
  }, [markFileDirty, handleEditorUpdate]);

  const handleSelectFile = useCallback((file) => {
    setSelectedFile(file);
    setSaveError('');
    setWorkspaceNotice('');
    openFileInEditor(file);
  }, [openFileInEditor]);

  /* ── Phase 6.1: workspace events affecting the currently open file ──
     FileExplorer forwards every remote file rename/move/delete here
     regardless of which file it touched; these no-op unless it's the
     one currently open. Nothing here ever touches the Yjs room or the
     Monaco model's content/undo history for a rename or move — both
     are keyed by file `_id`, not name/path, so that collaboration
     session keeps running untouched underneath the updated label. */
  const handleRemoteFileRenamed = useCallback((fileId, name) => {
    const current = selectedFileRef.current;
    if (!current || current._id !== fileId || current.name === name) return;

    const oldLang = resolveLanguage(current);
    const newLang = resolveLanguage({ ...current, name });

    setSelectedFile(prev => (prev && prev._id === fileId ? { ...prev, name } : prev));

    if (oldLang !== newLang) {
      const model = modelsRef.current.get(fileId);
      if (model && monacoRef.current) {
        monacoRef.current.editor.setModelLanguage(model, newLang);
      }
    }
  }, []);

  const handleRemoteFileMoved = useCallback((fileId, folderId) => {
    setSelectedFile(prev => (prev && prev._id === fileId ? { ...prev, folderId } : prev));
  }, []);

  const handleRemoteFileDeleted = useCallback((fileId) => {
    if (fileId !== selectedFileRef.current?._id) return;

    collabBindingRef.current?.destroy();
    collabBindingRef.current = null;

    const model = modelsRef.current.get(fileId);
    cursorRenderingRef.current?.prepareFileSwitch(fileId, model, editorRef.current);
    editorRef.current?.setModel(null);

    modelsRef.current.delete(fileId);
    viewStatesRef.current.delete(fileId);
    savedContentRef.current.delete(fileId);
    model?.dispose();

    setDirtyFileIds(prev => {
      if (!prev.has(fileId)) return prev;
      const next = new Set(prev);
      next.delete(fileId);
      return next;
    });

    setSelectedFile(null);
    setSaveError('');
    setWorkspaceNotice('This file was deleted by another collaborator.');
  }, []);

  /* Saves the currently open file's content via the Phase 4 endpoint.
     Guarded by savingRef so two overlapping saves can never be in
     flight at once — the Save button disables itself while `saving`,
     but Ctrl/Cmd+S (bound once at mount, see handleEditorMount) calls
     this directly and isn't subject to that disabled state, so without
     this guard a rapid double Ctrl+S could fire two PATCH requests
     whose responses resolve out of order, letting the earlier
     (staler) request's content overwrite the later, more current one. */
  const handleSaveFile = useCallback(async () => {
    if (savingRef.current) return;

    const file   = selectedFileRef.current;
    const editor = editorRef.current;
    if (!file || !editor) return;

    const content = editor.getValue();
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      await api.patch(`/projects/files/${file._id}/content`, { content });
      savedContentRef.current.set(file._id, content);
      setDirtyFileIds(prev => {
        if (!prev.has(file._id)) return prev;
        const next = new Set(prev);
        next.delete(file._id);
        return next;
      });
    } catch (err) {
      setSaveError(err.response?.data?.message || 'Failed to save file.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  /* Kept in a ref so Monaco's Ctrl/Cmd+S command (bound once at mount)
     always calls the latest version rather than a stale closure. */
  const handleSaveFileRef = useRef(handleSaveFile);
  useEffect(() => { handleSaveFileRef.current = handleSaveFile; }, [handleSaveFile]);

  const [showSnapshots, setShowSnapshots]       = useState(false);
  const [snapshots, setSnapshots]               = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [savingSnapshot, setSavingSnapshot]     = useState(false);
  const [restoringId, setRestoringId]           = useState(null);

  /* Fetch project metadata (Phase 3: real Project/Folder/File tree, not the old /documents API) */
  useEffect(() => {
    if (!projectId) return;
    api.get(`/projects/${projectId}/tree`)
      .then(({ data }) => {
        const project = data.data.project;
        setDoc({ title: project.name, language: project.language });
      })
      .catch(err => setDocError(
        err.response?.status === 404 ? 'Project not found.' : 'Failed to load project.'
      ))
      .finally(() => setDocLoading(false));
  }, [projectId]);

  /* Yjs + Socket.io — one Y.Doc per open file (Phase 5), bound to
     Monaco via handleDocReady below once the room's initial sync has
     applied. */
  const {
    connected, peers, getText, replaceText, cursors, sendCursor, typingSocketIds,
    isLocalTyping,
  } = useYjs({
    fileId:     selectedFileId,
    user,
    onDocReady: handleDocReady,
  });

  /* Phase 6.4 — file presence. `isLocalTyping` (from useYjs, already
     debounced) drives the editing⇄viewing state this client
     announces for whichever file is currently open; `filePresence` is
     the live map of what everyone ELSE has announced, project-wide —
     threaded down to FileExplorer for its per-file badges, and sliced
     to just the open file for FilePresenceBar below. */
  const { filePresence } = useFilePresence({
    projectId,
    fileId:    selectedFileId,
    isEditing: isLocalTyping,
  });

  /* Phase 6.3.5 — resizable left sidebar / AI chat panel. */
  const sidebarResize = useResizablePanel({ ...SIDEBAR_WIDTH,  edge: 'right' });
  const aiPanelResize = useResizablePanel({ ...AI_PANEL_WIDTH, edge: 'left'  });
  const [aiChatOpen, setAiChatOpen] = useState(true);

  useEffect(() => { sendCursorRef.current = sendCursor; }, [sendCursor]);

  /* Phase 5.4/5.5: remote-cursor rendering (caret, selection highlight,
     floating username badge, typing indicator) — extracted into
     useRemoteCursors so this component stays focused on editor/file
     lifecycle. See that hook for the full explanation of the Monaco
     APIs involved; this call just wires it to the current editor/model
     refs and the already-synchronized `cursors`/`typingSocketIds`
     state from useYjs above. */
  const cursorRendering = useRemoteCursors({
    editorRef,
    monacoRef,
    cursors,
    typingSocketIds,
    selectedFileId,
    currentUserId: user?.id,
  });
  useEffect(() => { cursorRenderingRef.current = cursorRendering; }, [cursorRendering]);

const { messages: aiMessages, loading: aiLoading, send: sendAI,
        clearHistory: clearAIHistory, contextNote } = useAI({ peers });

  const { output, running, outputOpen, setOutputOpen, run, cancel, clearOutput } = useExecution();
  /* Monaco mount */
  const handleEditorMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    /* Custom Code Ground theme */
    monaco.editor.defineTheme('codeground', {
      base: 'vs-dark', inherit: true,
      rules: [
        { token: 'comment',  foreground: '4B5563', fontStyle: 'italic' },
        { token: 'keyword',  foreground: '93C5FD' },
        { token: 'string',   foreground: '86EFAC' },
        { token: 'number',   foreground: 'F9A8D4' },
        { token: 'type',     foreground: '67E8F9' },
        { token: 'function', foreground: 'FDE68A' },
      ],
      colors: {
        'editor.background':                 '#080B14',
        'editor.foreground':                 '#E2E8F0',
        'editorLineNumber.foreground':       '#1E293B',
        'editorLineNumber.activeForeground': '#475569',
        'editor.lineHighlightBackground':    '#0D1117',
        'editorCursor.foreground':           '#3B82F6',
        'editor.selectionBackground':        '#1E3A5F',
        'editorWidget.background':           '#0D1117',
        'editorSuggestWidget.background':    '#0D1117',
        'editorSuggestWidget.border':        '#1E293B',
        'input.background':                  '#161B22',
        'scrollbarSlider.background':        '#1E293B',
        'editorGutter.background':           '#080B14',
      },
    });
    monaco.editor.setTheme('codeground');

    /* Ctrl/Cmd+S saves the currently open file (Phase 4 — no
       collaboration binding here; Monaco's model is driven directly
       by the selected file's content, per openFileInEditor above). */
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => handleSaveFileRef.current(),
    );

    /* Phase 5.4: broadcast our own cursor position (and selection, if
       any) to the room whenever either changes — bound once here (not
       per-file) since the editor instance is stable across file
       switches; sendCursorRef always points at whichever file's room
       is currently joined. onDidChangeCursorSelection (rather than
       onDidChangeCursorPosition) fires for both a plain caret move and
       a real text selection, and its Selection object's start/end
       fields are already normalized (start <= end) regardless of drag
       direction — exactly what's needed to also render remote
       selection highlights. Fires for any change, including ones
       caused by an incoming remote edit shifting our cursor — that's
       still our real current position, so still worth reporting. */
    editor.onDidChangeCursorSelection((e) => {
      const sel = e.selection;
      const position  = { lineNumber: sel.positionLineNumber, column: sel.positionColumn };
      const selection = sel.isEmpty() ? null : {
        startLineNumber: sel.startLineNumber, startColumn: sel.startColumn,
        endLineNumber:   sel.endLineNumber,   endColumn:   sel.endColumn,
      };
      sendCursorRef.current({ position, selection });
    });

    /* If a file was already selected before Monaco finished mounting,
       load it now. */
    if (selectedFileRef.current) openFileInEditor(selectedFileRef.current);
  }, [openFileInEditor]);

  /* Run code in Docker sandbox */
  // async function handleRun() {
  //   if (!editorRef.current || running) return;
  //   const code = editorRef.current.getValue();
  //   if (!code.trim()) return;

  //   setRunning(true);
  //   setOutput(null);
  //   setOutputOpen(true);

  //   try {
  //     const { data } = await api.post('/execute', { code, language: doc?.language ?? 'javascript' });
  //     setOutput(data);
  //   } catch (err) {
  //     setOutput({ stdout: '', stderr: err.response?.data?.error ?? 'Execution failed.', elapsed_ms: 0, success: false });
  //   } finally {
  //     setRunning(false);
  //   }
  // }

  function handleRun() {
  run(editorRef.current?.getValue() ?? '', doc?.language ?? 'javascript');
}

    async function loadSnapshots() {
    setSnapshotsLoading(true);
    try {
      const { data } = await api.get(`/documents/${docId}/snapshots`);
      setSnapshots(data);
    } finally {
      setSnapshotsLoading(false);
    }
  }

async function handleSaveSnapshot(label) {
  setSavingSnapshot(true);
  try {
    const { data } = await api.post(`/documents/${docId}/snapshots`, {
      label,
      content: getText(),              // ← was editorRef.current.getValue()
      language: doc?.language,
    });
    setSnapshots(prev => [data, ...prev]);
  } finally {
    setSavingSnapshot(false);
  }
}

async function handleRestoreSnapshot(snapshot) {
  setRestoringId(snapshot.id);
  try {
    replaceText(snapshot.content);     // ← was the manual ydoc.transact block
  } finally {
    setRestoringId(null);
    setShowSnapshots(false);
  }
}

  /* Send message to AI pair programmer */
  // async function handleAISend(question) {
  //   if (!question.trim() || aiLoading) return;

  //   const code     = editorRef.current?.getValue() ?? '';
  //   const language = doc?.language ?? 'javascript';

  //   const userMsg = { id: Date.now(),     role: 'user',      content: question, username: user?.username };
  //   const aiMsgId = Date.now() + 1;
  //   const aiMsg   = { id: aiMsgId, role: 'assistant', content: '', streaming: true };

  //   setAiMessages(prev => [...prev, userMsg, aiMsg]);
  //   setAiLoading(true);

  //   try {
  //     const token    = localStorage.getItem('cg_token');
  //     const response = await fetch('/api/ai/ask', {
  //       method:  'POST',
  //       headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  //       body:    JSON.stringify({
  //         question, code, language,
  //         editLog:    editLogRef.current.slice(-20),
  //         peers:      peers.map(p => p.name),
  //         lastOutput: output
  //           ? { stdout: output.stdout?.slice(0, 500), stderr: output.stderr?.slice(0, 500) }
  //           : null,
  //       }),
  //     });

  //     if (!response.ok) throw new Error(`HTTP ${response.status}`);

  //     const reader  = response.body.getReader();
  //     const decoder = new TextDecoder();
  //     let   buffer  = '';

  //     while (true) {
  //       const { done, value } = await reader.read();
  //       if (done) break;
  //       buffer += decoder.decode(value, { stream: true });
  //       const lines = buffer.split('\n');
  //       buffer = lines.pop() ?? '';

  //       for (const line of lines) {
  //         if (!line.startsWith('data: ')) continue;
  //         const chunk = line.slice(6);
  //         if (chunk === '[DONE]') continue;
  //         setAiMessages(prev => prev.map(m =>
  //           m.id === aiMsgId ? { ...m, content: m.content + chunk } : m
  //         ));
  //       }
  //     }

  //   } catch {
  //     setAiMessages(prev => prev.map(m =>
  //       m.id === aiMsgId ? { ...m, content: 'Something went wrong. Please try again.', streaming: false } : m
  //     ));
  //   } finally {
  //     setAiMessages(prev => prev.map(m =>
  //       m.id === aiMsgId ? { ...m, streaming: false } : m
  //     ));
  //     setAiLoading(false);
  //   }
  // }
function handleAISend(question) {
  sendAI(question, {
    code:       editorRef.current?.getValue() ?? '',
    language:   doc?.language ?? 'javascript',
    editLog:    editLogRef.current.slice(-20),
    peers,
    lastOutput: output
      ? { stdout: output.stdout?.slice(0, 500), stderr: output.stderr?.slice(0, 500) }
      : null,
    username:   user?.username,
  });
}
  // const contextNote = useMemo(() => {
  //   if (peers.length === 0) return 'Watching your edits';
  //   if (peers.length === 1) return `Watching you and ${peers[0].name}`;
  //   return `Watching ${peers.length + 1} people`;
  // }, [peers]);

  /* Error page */
  if (docError) {
    return (
      <div className={styles.error_root}>
        <div className={styles.error_card}>
          <span className={styles.error_icon} aria-hidden="true">&lt;404/&gt;</span>
          <h1 className={styles.error_heading}>{docError}</h1>
          <p className={styles.error_sub}>
            The document may have been deleted or you may not have access.
          </p>
          <Link to="/dashboard" className={styles.error_back_btn}>← Back to dashboard</Link>
        </div>
      </div>
    );
  }

  /* Main render */
  return (
  <div className={styles.root}>

    <Navbar 
      title={doc?.title}
      onTitleChange={async (newTitle) => {
        const { data } = await api.patch(`/projects/${projectId}`, { name: newTitle });
        setDoc(d => ({ ...d, title: data.data.name }));
      }}
      docLoading={docLoading}
      language={doc?.language}
      onLanguageChange={async (newLang) => {
        const { data } = await api.patch(`/projects/${projectId}`, { language: newLang });
        setDoc(d => ({ ...d, language: data.data.language ?? newLang }));
      }}
      connected={connected}
      currentUser={user}
      peers={peers}
      onOpenSnapshots={() => { setShowSnapshots(true); loadSnapshots(); }}
      onRunClick={handleRun}
      running={running}
      runDisabled={docLoading}
      documentId={docId}
      onSaveFile={handleSaveFile}
      fileDirty={selectedFile ? dirtyFileIds.has(selectedFile._id) : false}
      savingFile={saving}
      saveFileDisabled={!selectedFile}
      aiChatOpen={aiChatOpen}
      onToggleAIChat={() => setAiChatOpen(o => !o)}
    />

    {/* ── Body: file explorer + editor + right panel ── */}
    <div className={styles.body}>

      {/* Workspace file explorer — Phase 3 navigation + Phase 6.1 live
          sync — width controlled by the resize handle just after it
          (Phase 6.3.5). */}
      <div
        className={styles.sidebar_wrap}
        style={{
          '--sidebar-width': `${sidebarResize.width}px`,
          transition: sidebarResize.dragging ? 'none' : undefined,
        }}
      >
        <FileExplorer
          projectId={projectId}
          selectedFileId={selectedFileId}
          onSelectFile={handleSelectFile}
          onRemoteFileRenamed={handleRemoteFileRenamed}
          onRemoteFileMoved={handleRemoteFileMoved}
          onRemoteFileDeleted={handleRemoteFileDeleted}
          filePresence={filePresence}
        />
      </div>

      <div
        className={`${styles.resize_handle} ${sidebarResize.dragging ? styles.resize_handle_active : ''}`}
        onPointerDown={sidebarResize.onHandlePointerDown}
        onDoubleClick={sidebarResize.onHandleDoubleClick}
        title="Drag to resize · double-click to reset"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize file explorer panel"
      />

      {/* Monaco editor */}
      <div className={styles.editor_wrap}>
        {/* Phase 6.4 — who else has this file open right now */}
        <FilePresenceBar presence={selectedFileId ? filePresence[selectedFileId] : undefined} />

        <div className={styles.monaco_wrap}>
          {(saveError || workspaceNotice) && (
            <div
              role="alert"
              style={{
                position: 'absolute', top: 8, right: 8, zIndex: 5,
                background: saveError ? '#7f1d1d' : '#1e3a5f',
                color: saveError ? '#fecaca' : '#bfdbfe',
                padding: '4px 10px', borderRadius: 6, fontSize: 12,
              }}
            >
              {saveError || workspaceNotice}
            </div>
          )}
          <MonacoEditor
            height="100%"
            language={doc?.language ?? 'javascript'}
            theme="codeground"
            onMount={handleEditorMount}
            loading={
              <div className={styles.editor_loading}>
                <Spinner size={20} />
                <span>Loading editor…</span>
              </div>
            }
            options={{
              readOnly:                   !selectedFile,
              fontSize:                   14,
              fontFamily:                 "'JetBrains Mono', monospace",
              fontLigatures:              true,
              lineHeight:                 1.8,
              letterSpacing:              0.3,
              minimap:                    { enabled: false },
              scrollBeyondLastLine:        false,
              smoothScrolling:             true,
              cursorBlinking:              'phase',
              cursorSmoothCaretAnimation: 'on',
              padding:                    { top: 20, bottom: 20 },
              wordWrap:                   'on',
              tabSize:                    2,
              renderLineHighlight:        'line',
              bracketPairColorization:    { enabled: true },
              formatOnPaste:              true,
              suggestOnTriggerCharacters: true,
              scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
              /* Phase 6.3.5 — both resize handles change this
                 container's size via CSS, not a window resize event;
                 without this Monaco never notices and its canvas
                 stays the old size. */
              automaticLayout: true,
            }}
          />
        </div>
      </div>

      {/* AI chat / output panel — resizable + collapsible (Phase 6.3.5).
          The handle only exists while the panel is open; there's
          nothing to drag against once it's collapsed to 0. */}
      {aiChatOpen && (
        <div
          className={`${styles.resize_handle} ${aiPanelResize.dragging ? styles.resize_handle_active : ''}`}
          onPointerDown={aiPanelResize.onHandlePointerDown}
          onDoubleClick={aiPanelResize.onHandleDoubleClick}
          title="Drag to resize · double-click to reset"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize AI chat panel"
        />
      )}

      <div
        className={`${styles.right_panel} ${!aiChatOpen ? styles.right_panel_collapsed : ''}`}
        style={{
          '--rp-width': aiChatOpen ? `${aiPanelResize.width}px` : '0px',
          transition: aiPanelResize.dragging ? 'none' : undefined,
        }}
      >
        {/* Never unmounted while collapsed — preserves AISidebar's own
            message list / input state so reopening restores exactly
            where the conversation left off. */}
        <AISidebar
  messages={aiMessages}
  loading={aiLoading}
  onSend={handleAISend}
  onClear={clearAIHistory}
  contextNote={contextNote}
  currentUser={user}
/>
        <OutputPanel
          output={output}
          running={running}
          open={outputOpen}
          onToggle={() => setOutputOpen(o => !o)}
          onClear={clearOutput}
        />
      </div>

    </div>

    {/* Snapshots drawer — fixed-positioned, sits anywhere in the tree */}
    <SnapshotDrawer
      open={showSnapshots}
      onClose={() => setShowSnapshots(false)}
      snapshots={snapshots}
      loadingList={snapshotsLoading}
      onSave={handleSaveSnapshot}
      saving={savingSnapshot}
      onRestore={handleRestoreSnapshot}
      restoringId={restoringId}
    />

  </div>
);
}
