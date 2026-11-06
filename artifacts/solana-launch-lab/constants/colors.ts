/**
 * Semantic design tokens for the mobile app.
 *
 * These tokens mirror the naming conventions used in web artifacts (index.css)
 * so that multi-artifact projects share a cohesive visual identity.
 *
 * Replace the placeholder values below with values that match the project's
 * brand. If a sibling web artifact exists, read its index.css and convert the
 * HSL values to hex so both artifacts use the same palette.
 *
 * To add dark mode, add a `dark` key with the same token names.
 * The useColors() hook will automatically pick it up.
 */

const night = {
  text: '#edf2ed',
  tint: '#c5f279',
  background: '#080d0a',
  foreground: '#edf2ed',
  card: '#101713',
  cardForeground: '#edf2ed',
  primary: '#c5f279',
  primaryForeground: '#0b100c',
  secondary: '#17211a',
  secondaryForeground: '#dce8df',
  muted: '#131b16',
  mutedForeground: '#8f9e93',
  accent: '#1b3020',
  accentForeground: '#d7ff9d',
  destructive: '#ff777e',
  destructiveForeground: '#1a0b0d',
  border: '#26342a',
  input: '#1a261e',
  cardRaised: '#151e18',
  surface: '#0d130f',
  success: '#b8ec83',
  warning: '#edc078',
  cyan: '#81ddcf',
  glow: 'rgba(173, 235, 102, 0.11)',
  softGlow: 'rgba(132, 224, 206, 0.09)',
  dangerSurface: '#281416',
};

const colors = {
  light: night,
  dark: night,
  radius: 18,
};

export default colors;
