
import { Routes, Route, Navigate } from 'react-router-dom';
import { useState }                from 'react';
import { AuthProvider, useAuth }   from './hooks/useAuth.jsx';
import Landing     from './pages/Landing.jsx';
import Login       from './pages/Login.jsx';
import Register    from './pages/Register.jsx';
import Dashboard   from './pages/Dashboard.jsx';
import Editor      from './pages/Editor.jsx';
import Invitations from './pages/Invitations.jsx';
import Pricing     from './pages/Pricing.jsx';
import Presence    from './components/Presence.jsx';
import OutputPanel from './components/OutputPanel.jsx';

function PrivateRoute({ children }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

function PublicOnlyRoute({ children }) {
  const { user } = useAuth();
  return user ? <Navigate to="/dashboard" replace /> : children;
}

/* ───────────────────────────────────────────
   DEV-ONLY TEST PAGES — remove before shipping
─────────────────────────────────────────── */

function PresenceTest() {
  return (
    <div style={{ padding: 40, background: '#080B14', height: '100vh' }}>
      <Presence
        currentUser={{ username: 'punyashree' }}
        peers={[
          { userId: '1', name: 'Alice', active: true },
          { userId: '2', name: 'Bob' },
          { userId: '3', name: 'Charlie' },
          { userId: '4', name: 'Diana' },
          { userId: '5', name: 'Evan' },
        ]}
        maxVisible={4}
      />
    </div>
  );
}

function OutputTest() {
  const [open, setOpen] = useState(true);
  const [output, setOutput] = useState({
    stdout: 'Building...\nCompiled successfully.\nServer running on port 4000',
    stderr: 'Warning: deprecated API used on line 12',
    elapsed_ms: 842,
    success: true,
  });

  return (
    <div style={{ width: 400, margin: '40px auto' }}>
      <OutputPanel
        output={output}
        running={false}
        open={open}
        onToggle={() => setOpen(o => !o)}
        onClear={() => setOutput(null)}
      />
    </div>
  );
}

/* ───────────────────────────────────────────
   ROUTES
─────────────────────────────────────────── */

function AppRoutes() {
  return (
    <Routes>
      <Route path="/"         element={<Landing />}  />
      <Route path="/login"    element={
        <PublicOnlyRoute><Login /></PublicOnlyRoute>
      } />
      <Route path="/register" element={
        <PublicOnlyRoute><Register /></PublicOnlyRoute>
      } />
      <Route path="/pricing"  element={<Pricing />}  />
      <Route path="/dashboard" element={
        <PrivateRoute><Dashboard /></PrivateRoute>
      } />
      <Route path="/invitations" element={
        <PrivateRoute><Invitations /></PrivateRoute>
      } />
      <Route path="/editor/:docId" element={
        <PrivateRoute><Editor /></PrivateRoute>
      } />

      {/* Dev-only — delete these before deploying */}
      <Route path="/presence-test" element={<PresenceTest />} />
      <Route path="/output-test"   element={<OutputTest />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}