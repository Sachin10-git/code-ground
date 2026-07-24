/**
 * collaboratorColor.js — deterministic per-user color assignment
 *
 * One fixed 8-color palette, one hash function: the same name always
 * resolves to the same slot, for the lifetime of the session, with no
 * server round-trip and no coordination between clients required. Used
 * by useRemoteCursors.js (caret / selection / badge colors). Presence
 * chips elsewhere in the app (Editor.jsx's own `avatarColor`) use the
 * same 8 hex values independently — kept as a separate small constant
 * here rather than sharing an import, so this module has no dependency
 * on page-level code and can be reused anywhere without pulling in
 * unrelated UI.
 */

export const COLLABORATOR_COLORS = [
  '#3B82F6', '#22D3EE', '#34D399', '#F59E0B',
  '#EC4899', '#8B5CF6', '#F87171', '#60A5FA',
];

/**
 * Palette slot index (0..COLLABORATOR_COLORS.length-1) for a given
 * name — stable for that exact string, not randomized, not reassigned
 * on reconnect.
 */
export function collaboratorColorIndex(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % COLLABORATOR_COLORS.length;
}

/** Convenience wrapper returning the hex color directly. */
export function collaboratorColor(name = '') {
  return COLLABORATOR_COLORS[collaboratorColorIndex(name)];
}
