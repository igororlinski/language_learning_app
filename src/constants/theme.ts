import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#11181C',
    textSecondary: '#5C6670',
    background: '#F5F6F8',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E8EBEF',
    border: '#E1E4E9',
    accent: '#2F6FED',
    onAccent: '#FFFFFF',
    danger: '#CE2C31',
  },
  dark: {
    text: '#ECEDEE',
    textSecondary: '#9BA1A6',
    background: '#0E0F11',
    backgroundElement: '#1A1C1F',
    backgroundSelected: '#26292D',
    border: '#2A2D31',
    accent: '#5A8DF6',
    onAccent: '#0E0F11',
    danger: '#F2555A',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Rating colours are deliberately identical in both schemes, like in Anki. */
export const RatingColors = {
  again: '#E5484D',
  hard: '#F5A524',
  good: '#30A46C',
  easy: '#3E8FF5',
} as const;

/**
 * Queue counters follow Anki's palette: blue for new, red for learning,
 * green for review. Like `RatingColors`, identical in both schemes.
 */
export const QueueColors = {
  new: '#3E8FF5',
  learning: '#E5484D',
  review: '#30A46C',
} as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 12,
  large: 16,
} as const;

export const MaxContentWidth = 800;
