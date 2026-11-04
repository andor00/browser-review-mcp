// Settings shared by the overlay and the help page, kept in chrome.storage.local.

/** Hold this key to pick an element; release it to stop. Set on the help page. */
export const HOLD_KEY = 'holdToPick';

export const HOLD_KEYS = {
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  off: 'Off',
} as const;

/** A KeyboardEvent.code, or 'off'. */
export type HoldKey = keyof typeof HOLD_KEYS;
export const DEFAULT_HOLD_KEY: HoldKey = 'AltLeft';

export function toHoldKey(value: unknown): HoldKey {
  return typeof value === 'string' && value in HOLD_KEYS ? (value as HoldKey) : DEFAULT_HOLD_KEY;
}
