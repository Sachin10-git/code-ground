// MOCK api.js — replace with real version when backend is ready
const MOCK_DOCS = [
  {
    id: 'doc-1',
    title: 'auth-service',
    language: 'javascript',
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    owner_id: 'mock-user-1',
    is_public: false,
    member_count: 2,
    session_summary: 'Alice and Bob implemented JWT refresh token rotation and fixed a race condition in the token validation middleware.',
    last_session_at: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'doc-2',
    title: 'data-pipeline',
    language: 'python',
    updated_at: new Date(Date.now() - 86400000).toISOString(),
    created_at: new Date(Date.now() - 86400000).toISOString(),
    owner_id: 'mock-user-1',
    is_public: false,
    member_count: 0,
    session_summary: null,
    last_session_at: null,
  },
  {
    id: 'doc-3',
    title: 'interview-prep',
    language: 'go',
    updated_at: new Date(Date.now() - 172800000).toISOString(),
    created_at: new Date(Date.now() - 172800000).toISOString(),
    owner_id: 'mock-user-1',
    is_public: true,
    member_count: 1,
    session_summary: 'Solved three graph problems and optimised the BFS solution from O(n²) to O(n log n).',
    last_session_at: new Date(Date.now() - 172800000).toISOString(),
  },
];

const MOCK_DOC = {
  id: 'doc-1',
  title: 'auth-service',
  language: 'javascript',
  updated_at: new Date().toISOString(),
  owner_id: 'mock-user-1',
  is_public: false,
};

/* In-memory mock snapshot store — lets newly-saved snapshots
   actually appear in the list without a real backend. */
let MOCK_SNAPSHOTS = [
  { id: 'snap-1', label: 'Initial setup',         created_by_name: 'punyashree', created_at: new Date(Date.now() - 7200000).toISOString() },
  { id: 'snap-2', label: 'Added error handling',  created_by_name: 'punyashree', created_at: new Date(Date.now() - 1800000).toISOString() },
];

/* Mock signed-in user — returned by /auth/login, /auth/register,
   and /auth/me. is_paid starts false so Pricing.jsx's upgrade flow
   has something to upgrade FROM. */
let MOCK_USER = {
  id:       'mock-user-1',
  username: 'punyashree',
  email:    'punyashree@example.com',
  is_paid:  false,
};

// Simulates network delay so you see loading states
function delay(ms = 600) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const api = {
  get: async (url) => {
    await delay();

    /* Auth check — used by useAuth.jsx on app boot to verify
       a stored token is still valid and refresh the user object. */
    if (url === '/auth/me') return { data: MOCK_USER };

    /* IMPORTANT: more specific checks must come BEFORE
       more general ones — /snapshots before /documents/ */
    if (url === '/documents')          return { data: MOCK_DOCS };
    if (url.endsWith('/snapshots'))    return { data: MOCK_SNAPSHOTS };
    if (url.startsWith('/documents/')) return { data: MOCK_DOC };

    return { data: {} };
  },

  post: async (url, body) => {
    await delay(400);

    /* ── Auth endpoints ──
       Both login and register return the same { token, user } shape
       that useAuth.jsx expects. In this mock, ANY email/password
       combination succeeds — there's no real credential check since
       there's no real backend yet. Swap this file for a real Axios
       instance once the backend exists; useAuth.jsx needs no changes. */
    if (url === '/auth/login') {
      MOCK_USER = { ...MOCK_USER, email: body.email };
      return { data: { token: 'mock-jwt-token', user: MOCK_USER } };
    }

    if (url === '/auth/register') {
      MOCK_USER = {
        id:       'mock-user-1',
        username: body.username,
        email:    body.email,
        is_paid:  false,
      };
      return { data: { token: 'mock-jwt-token', user: MOCK_USER } };
    }

    if (url === '/auth/logout') {
      return { data: { success: true } };
    }

    if (url === '/documents') {
      const newDoc = {
        id: 'doc-' + Date.now(),
        title: body.title,
        language: body.language,
        updated_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        owner_id: 'mock-user-1',
        is_public: false,
        member_count: 0,
        session_summary: null,
      };
      return { data: newDoc };
    }

    if (url === '/execute') {
      return {
        data: {
          stdout: `Hello from ${body.language}!\nExecution complete.`,
          stderr: '',
          elapsed_ms: 312,
          success: true,
        },
      };
    }

    if (url.endsWith('/snapshots')) {
      const newSnapshot = {
        id: 'snap-' + Date.now(),
        label: body.label,
        created_by_name: 'punyashree',
        created_at: new Date().toISOString(),
        content: body.content,
        language: body.language,
      };
      /* Persist into the in-memory store so a subsequent GET
         (e.g. reopening the drawer) still shows it. */
      MOCK_SNAPSHOTS = [newSnapshot, ...MOCK_SNAPSHOTS];
      return { data: newSnapshot };
    }

    if (url === '/api/ai/ask') {
      return { data: { message: 'Mock AI response' } };
    }

    return { data: {} };
  },

  patch: async (url, body) => {
    await delay(300);
    return { data: { ...MOCK_DOC, ...body } };
  },

  delete: async (url) => {
    await delay(300);
    /* Handle snapshot deletion in the mock store too */
    const match = url.match(/\/snapshots\/(.+)$/);
    if (match) {
      const id = match[1];
      MOCK_SNAPSHOTS = MOCK_SNAPSHOTS.filter(s => s.id !== id);
    }
    return { data: { success: true } };
  },
};

export default api;
