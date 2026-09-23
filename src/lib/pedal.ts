/**
 * Bluetooth page-turner pedals (AirTurn, PageFlip, Donner, Coolmusic…) pair
 * as KEYBOARDS and send one key per footswitch. Which key depends on the
 * pedal's mode, so we accept every common mapping:
 *   next: → / ↓ / PageDown / Space
 *   prev: ← / ↑ / PageUp
 * Enter is deliberately not "next" — some pedals send it, but so does the
 * on-screen keyboard when someone is finishing a note.
 */
export function isPedalNext(e: KeyboardEvent): boolean {
  return e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ' || e.code === 'Space'
}
export function isPedalPrev(e: KeyboardEvent): boolean {
  return e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp'
}
