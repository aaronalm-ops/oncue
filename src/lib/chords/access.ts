/**
 * Chords rollout gate.
 *
 * While the parser is being verified, chord views are visible ONLY to
 * editors (master / admin / worship_leader). Members see no chords UI at
 * all — no service chords list, no chords pane, no chords pages.
 *
 * When the team is happy with parsing quality, flip this to true and
 * redeploy — that single change opens chords to everyone. (Unreviewed
 * versions remain hidden from members regardless, via RLS.)
 */
export const CHORDS_OPEN_TO_ALL = false

const EDITOR_ROLES = ['master', 'admin', 'worship_leader']

export function canSeeChords(role: string | null | undefined): boolean {
  return CHORDS_OPEN_TO_ALL || EDITOR_ROLES.includes(role ?? '')
}
