// Worker mobile theme — purple base palette (mirrors the web worker theme).
// Job-type colors match the web app: packing = red, unpacking = amber, organizing = blue.

export const colors = {
  // Purple primary scale (worker base palette)
  primary: '#735B91',
  primaryDark: '#5E4A78',
  primaryLight: '#EEE8F4',
  primaryBg: '#F7F3FA',

  bg: '#f6f1e8',
  card: '#ffffff',
  text: '#2f251a',
  muted: '#6d6254',
  border: '#d8d2c7',
  danger: '#b34a3e',
  white: '#ffffff',

  // Job-type hues (aligned app-wide)
  packing: '#dc2626',
  unpacking: '#d97706',
  organizing: '#2563eb',

  packingBg: '#fef2f2',
  unpackingBg: '#fffbeb',
  organizingBg: '#eff6ff',
} as const;

export function jobTypeColor(type: string): string {
  if (type === 'PACKING') return colors.packing;
  if (type === 'UNPACKING') return colors.unpacking;
  return colors.organizing;
}

export function jobTypeBg(type: string): string {
  if (type === 'PACKING') return colors.packingBg;
  if (type === 'UNPACKING') return colors.unpackingBg;
  return colors.organizingBg;
}
