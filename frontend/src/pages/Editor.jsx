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
import { useYjs } from '../hooks/useYjs.js';
import { useAI } from '../hooks/useAI.js';
import { useExecution } from '../hooks/useExecution.js';

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
  const { user }   = useAuth();
  const navigate   = useNavigate();

  const [doc,        setDoc]        = useState(null);
  const [docLoading, setDocLoading] = useState(true);
  const [docError,   setDocError]   = useState('');

  const [peers,      setPeers]      = useState([]);

  useEffect(() => {
  setPeers([
    { userId: '1', name: 'Alice',   active: true },
    { userId: '2', name: 'Bob' },
    { userId: '3', name: 'Charlie' },
  ]);
}, []);


  // const [output,     setOutput]     = useState(null);
  // const [running,    setRunning]    = useState(false);
  // const [outputOpen, setOutputOpen] = useState(true);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleVal,     setTitleVal]     = useState('');

  const editorRef  = useRef(null);
  const monacoRef  = useRef(null);
  const editLogRef = useRef([]);

  const [showSnapshots, setShowSnapshots]       = useState(false);
  const [snapshots, setSnapshots]               = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [savingSnapshot, setSavingSnapshot]     = useState(false);
  const [restoringId, setRestoringId]           = useState(null);

  /* Fetch document metadata */
  useEffect(() => {
    if (!docId) return;
    api.get(`/documents/${docId}`)
      .then(({ data }) => { setDoc(data); setTitleVal(data.title); })
      .catch(err => setDocError(
        err.response?.status === 404 ? 'Document not found.' : 'Failed to load document.'
      ))
      .finally(() => setDocLoading(false));
  }, [docId]);

  /* Track edits for AI context */
  const handleEditorUpdate = useCallback((text) => {
    editLogRef.current = [
      ...editLogRef.current.slice(-(MAX_EDIT_LOG - 1)),
      { username: user?.username ?? 'unknown', timestamp: new Date().toISOString(), preview: text.slice(0, 80) },
    ];
  }, [user?.username]);

  /* Yjs + Socket.io */
const { ydocRef, awarenessRef, bindingRef, connected, getText, replaceText } = useYjs({
  docId,
  user,
  onUpdate:      handleEditorUpdate,
  onPeersChange: setPeers,
});

const { messages: aiMessages, loading: aiLoading, send: sendAI,
        clearHistory: clearAIHistory, contextNote } = useAI({ peers });

  const { output, running, outputOpen, setOutputOpen, run, cancel, clearOutput } = useExecution();
  /* Monaco mount */
  const handleEditorMount = useCallback(async (editor, monaco) => {
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

    /* Bind Yjs to Monaco once both are ready */
    if (ydocRef.current) {
      try {
        const { MonacoBinding } = await import('y-monaco');
        const ytext = ydocRef.current.getText('content');
        bindingRef.current = new MonacoBinding(
          ytext,
          editor.getModel(),
          new Set([editor]),
          awarenessRef.current ?? undefined,
        );
      } catch (e) {
        console.warn('MonacoBinding unavailable:', e.message);
      }
    }
  }, [ydocRef, awarenessRef, bindingRef]);

  /* Save title on blur or Enter */
  async function saveTitle() {
    setEditingTitle(false);
    const newTitle = titleVal.trim();
    if (!newTitle || newTitle === doc?.title) return;
    try {
      const { data } = await api.put(`/documents/${docId}`, {
    title: newTitle,
    language: doc.language,
    content: getText(),
});
      setDoc(d => ({ ...d, title: data.title }));
    } catch { setTitleVal(doc?.title ?? ''); }
  }

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
        const { data } = await api.patch(`/documents/${docId}`, { title: newTitle });
        setDoc(d => ({ ...d, title: data.title }));
      }}
      docLoading={docLoading}
      language={doc?.language}
      onLanguageChange={async (newLang) => {
        const { data } = await api.put(`/documents/${docId}`, {
    title: doc.title,
    language: newLang,
    content: getText(),
});
        setDoc(d => ({ ...d, language: data.language ?? newLang }));
      }}
      connected={connected}
      currentUser={user}
      peers={peers}
      onOpenSnapshots={() => { setShowSnapshots(true); loadSnapshots(); }}
      onRunClick={handleRun}
      running={running}
      runDisabled={docLoading}
      documentId={docId}
    />

    {/* ── Body: editor + right panel ── */}
    <div className={styles.body}>

      {/* Monaco editor */}
      <div className={styles.editor_wrap}>
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
          }}
        />
      </div>

      {/* Right panel */}
      <div className={styles.right_panel}>
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
