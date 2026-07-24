/**
 * invitations.js — Phase 5.1 invitation API service
 *
 * Thin wrapper around the existing backend invitation endpoints
 * (backend/src/routes/invitation.routes.js). No new backend behavior —
 * just named calls so pages don't inline raw api.* paths.
 */

import api from './api.js';

export function getMyInvitations() {
  return api.get('/invitations');
}

export function acceptInvitation(invitationId) {
  return api.post(`/invitations/invite/${invitationId}/accept`);
}

export function rejectInvitation(invitationId) {
  return api.post(`/invitations/invite/${invitationId}/reject`);
}
