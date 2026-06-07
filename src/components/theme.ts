// ---------------------------------------------------------------------------
// Design tokens — shared across all components
// ---------------------------------------------------------------------------

export const COLORS = {
  bg: '#0a0a0a',
  surface: '#111111',
  border: '#222222',
  text: '#ffffff',
  muted: '#666666',
  accent: '#00ff88',     // green — used for running state and interactive elements
  error: '#ff4444',
  done: '#00cc66',
} as const;

export const FONTS = {
  // Use the system monospace stack; no custom font loading needed.
  mono: 'Courier New',
} as const;
