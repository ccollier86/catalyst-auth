/**
 * Shared design tokens for Catalyst admin surfaces. These tokens are intentionally lightweight so
 * that host applications can map them into Tailwind, CSS variables, or CSS-in-JS solutions.
 */
export const tokens = {
  color: {
    background: '#ffffff',
    surface: '#f7f7f8',
    border: '#dfe3ea',
    primary: '#3c61f0',
    danger: '#d6455d',
    text: '#1f2933',
    muted: '#4b5563'
  },
  radius: {
    sm: '6px',
    md: '12px',
    lg: '18px'
  },
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px'
  },
  shadow: {
    overlay: '0px 16px 40px rgba(0, 0, 0, 0.12)'
  },
  typography: {
    fontFamily: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
    headingWeight: 600,
    bodyWeight: 400
  }
} as const;
