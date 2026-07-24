/**
 * Invitations.jsx — Code Ground pending invitations (Phase 5.1)
 *
 * Lists the invitations the backend already stores for the signed-in
 * user's email (GET /api/invitations, added this phase) and lets them
 * Accept or Reject using the pre-existing backend endpoints:
 *
 *   POST /api/invitations/invite/:invitationId/accept
 *   POST /api/invitations/invite/:invitationId/reject
 *
 * No new backend logic is invented here — this page only calls what
 * already exists. On a successful Accept, the user is sent to
 * /dashboard, which always re-fetches GET /projects on mount, so the
 * newly shared project shows up there without any extra state
 * plumbing between the two pages.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth.jsx';
import { getMyInvitations, acceptInvitation, rejectInvitation } from '../utils/invitations.js';
import styles from './Invitations.module.css';

/* ─────────────────────────────────────────────────────────────────────
   HELPERS — small, self-contained (same pattern already used in
   Dashboard.jsx/Editor.jsx rather than a shared utils module).
───────────────────────────────────────────────────────────────────── */

function extractApiError(err) {
  return (
    err.response?.data?.message ||
    err.response?.data?.error ||
    'Something went wrong. Please try again.'
  );
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} days ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ─────────────────────────────────────────────────────────────────────
   ICONS
───────────────────────────────────────────────────────────────────── */

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

function Spinner({ size = 14 }) {
  return (
    <svg className={styles.spinner} width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      aria-hidden="true">
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────────────────
   INVITATIONS — page root
───────────────────────────────────────────────────────────────────── */
export default function Invitations() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [invitations, setInvitations] = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState('');
  const [actionId,    setActionId]    = useState(null); // invitation _id currently being accepted/rejected

  const loadInvitations = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError('');

    getMyInvitations()
      .then(({ data }) => {
        if (!cancelled) setInvitations(data.data ?? []);
      })
      .catch(err => {
        if (!cancelled) setFetchError(extractApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => loadInvitations(), [loadInvitations]);

  const handleAccept = useCallback(async (invitation) => {
    setActionId(invitation._id);
    try {
      await acceptInvitation(invitation._id);
      alert(`You joined ${invitation.projectId?.name ?? 'the workspace'}.`);
      /* Dashboard re-fetches /projects on every mount, so navigating
         there is what makes the newly shared project "appear". */
      navigate('/dashboard');
    } catch (err) {
      alert(extractApiError(err));
      setActionId(null);
    }
  }, [navigate]);

  const handleReject = useCallback(async (invitation) => {
    setActionId(invitation._id);
    try {
      await rejectInvitation(invitation._id);
      setInvitations(prev => prev.filter(i => i._id !== invitation._id));
    } catch (err) {
      alert(extractApiError(err));
    } finally {
      setActionId(null);
    }
  }, []);

  return (
    <div className={styles.root}>

      <header className={styles.topnav}>
        <Link to="/dashboard" className={styles.back_link} aria-label="Back to dashboard">
          <BackIcon /> Dashboard
        </Link>
        <span className={styles.nav_title}>Invitations</span>
        <span className={styles.nav_spacer} aria-hidden="true" />
      </header>

      <main className={styles.main}>
        <h1 className={styles.heading}>Pending invitations</h1>
        <p className={styles.sub}>
          Workspaces other people have invited {user?.username ?? 'you'} to join.
        </p>

        {fetchError && (
          <div className={styles.error_banner} role="alert">
            {fetchError}
            <button className={styles.retry_btn} onClick={loadInvitations}>
              Retry
            </button>
          </div>
        )}

        {loading && (
          <div className={styles.state_msg} aria-busy="true">
            <Spinner size={16} /> Loading invitations…
          </div>
        )}

        {!loading && !fetchError && invitations.length === 0 && (
          <div className={styles.empty} role="status">
            No pending invitations right now.
          </div>
        )}

        {!loading && invitations.length > 0 && (
          <ul className={styles.list} role="list" aria-label="Pending invitations">
            {invitations.map(inv => (
              <li key={inv._id} className={styles.card}>
                <div className={styles.card_main}>
                  <h2 className={styles.project_name}>
                    {inv.projectId?.name ?? 'Untitled workspace'}
                  </h2>
                  <p className={styles.meta}>
                    Invited by{' '}
                    <strong>{inv.inviterId?.username ?? inv.inviterId?.email ?? 'someone'}</strong>
                    {' '}as {inv.role ?? 'editor'} · {relativeTime(inv.createdAt)}
                  </p>
                </div>

                <div className={styles.actions}>
                  <button
                    className={styles.accept_btn}
                    onClick={() => handleAccept(inv)}
                    disabled={actionId === inv._id}
                    aria-label={`Accept invitation to ${inv.projectId?.name ?? 'workspace'}`}
                  >
                    {actionId === inv._id ? <Spinner size={14} /> : 'Accept'}
                  </button>
                  <button
                    className={styles.reject_btn}
                    onClick={() => handleReject(inv)}
                    disabled={actionId === inv._id}
                    aria-label={`Reject invitation to ${inv.projectId?.name ?? 'workspace'}`}
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
