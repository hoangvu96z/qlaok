/**
 * Contrast & Luminance helpers for storefront themes
 * Complies with WCAG relative luminance calculations.
 */

export function parseRgb(color?: string | null): [number, number, number] | null {
  if (!color || typeof color !== 'string') return null;
  const trimmed = color.trim();
  const hexCandidate = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{3}$/.test(hexCandidate)) {
    const r = parseInt(hexCandidate[0] + hexCandidate[0], 16);
    const g = parseInt(hexCandidate[1] + hexCandidate[1], 16);
    const b = parseInt(hexCandidate[2] + hexCandidate[2], 16);
    return [r, g, b];
  }
  if (/^[0-9a-fA-F]{6}$/.test(hexCandidate)) {
    const r = parseInt(hexCandidate.slice(0, 2), 16);
    const g = parseInt(hexCandidate.slice(2, 4), 16);
    const b = parseInt(hexCandidate.slice(4, 6), 16);
    return [r, g, b];
  }
  const match = trimmed.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (match) {
    return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)];
  }
  return null;
}

/**
 * Calculates WCAG relative luminance (0 to 1) for a color string.
 * Defaults to Emerald (#10b981) luminance (~0.364) if input is invalid.
 */
export function getHexLuminance(color?: string | null): number {
  const rgb = parseRgb(color);
  if (!rgb) return 0.364;
  const [rl, gl, bl] = rgb.map((v) => {
    const s = Math.max(0, Math.min(255, v)) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * Returns true if a color has high relative luminance (is "light"),
 * meaning dark text/elements provide better contrast than white text.
 * Pick the stronger contrast between slate-950 and white. The crossover
 * between these two colors is approximately 0.19 relative luminance.
 */
export function isLightColor(color?: string | null): boolean {
  return getHexLuminance(color) >= 0.19;
}

/**
 * Returns high-contrast text color ('#0f172a' or '#ffffff') for a given background color.
 */
export function getContrastTextColor(color?: string | null): string {
  return isLightColor(color) ? '#0f172a' : '#ffffff';
}
