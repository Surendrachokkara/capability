/**
 * Deterministic text measurer. Used by the tests (no PDF backend needed) and
 * as a fallback if jsPDF metrics are unavailable. Widths are a linear
 * approximation of Helvetica/Courier at a given point size — good enough to
 * exercise wrapping and pagination.
 */
const RATIO = { helvetica: 0.5, times: 0.48, courier: 0.6 };
const BOLD_BUMP = 1.05;

export function createFixedMeasurer() {
  return {
    measure(text, font, size, style) {
      const base = RATIO[font] ?? 0.5;
      const bump = style && style.includes('bold') ? BOLD_BUMP : 1;
      return String(text).length * size * base * bump;
    },
  };
}
