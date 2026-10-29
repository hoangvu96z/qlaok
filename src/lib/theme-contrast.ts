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
 * Calculates the WCAG contrast ratio between a foreground and a background.
 */
export function getContrastRatio(
  foreground?: string | null,
  background?: string | null
): number {
  const foregroundLuminance = getHexLuminance(foreground);
  const backgroundLuminance = getHexLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

/**
 * Keeps a shop's accent color for text when it is readable on the surface.
 * Otherwise, shifts it toward the higher-contrast black or white endpoint just
 * enough to meet the requested ratio while preserving the chosen hue as much
 * as possible.
 */
export function getAccessibleAccentTextColor(
  color?: string | null,
  background = '#ffffff',
  minimumContrast = 4.5
): string {
  const source = parseRgb(color);
  const surface = parseRgb(background);
  if (!surface) return '#020617';
  if (!source) return getContrastTextColor(background);

  const normalizedColor = `#${source
    .map((channel) => Math.max(0, Math.min(255, channel)).toString(16).padStart(2, '0'))
    .join('')}`;
  if (getContrastRatio(normalizedColor, background) >= minimumContrast) {
    return normalizedColor;
  }

  const endpoints: Array<[number, number, number]> = [
    [0, 0, 0],
    [255, 255, 255],
  ];
  const endpoint = endpoints.reduce((best, candidate) => {
    const bestHex = `#${best.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
    const candidateHex = `#${candidate.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
    return getContrastRatio(candidateHex, background) > getContrastRatio(bestHex, background)
      ? candidate
      : best;
  });

  let low = 0;
  let high = 1;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const amount = (low + high) / 2;
    const candidate = source.map((channel, index) =>
      Math.round(channel + (endpoint[index] - channel) * amount)
    ) as [number, number, number];
    const candidateHex = `#${candidate
      .map((channel) => channel.toString(16).padStart(2, '0'))
      .join('')}`;
    if (getContrastRatio(candidateHex, background) >= minimumContrast) {
      high = amount;
    } else {
      low = amount;
    }
  }

  return `#${source
    .map((channel, index) =>
      Math.round(channel + (endpoint[index] - channel) * high)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/**
 * Returns true if a color has high relative luminance (is "light"),
 * meaning dark text/elements provide better contrast than white text.
 * Compare actual WCAG contrast ratios for slate-950 and white.
 */
export function isLightColor(color?: string | null): boolean {
  const background = getHexLuminance(color);
  const darkText = getHexLuminance('#020617');
  return (background + 0.05) / (darkText + 0.05) >= 1.05 / (background + 0.05);
}

/**
 * Returns high-contrast text color ('#020617' or '#ffffff') for a given background color.
 */
export function getContrastTextColor(color?: string | null): string {
  return isLightColor(color) ? '#020617' : '#ffffff';
}
