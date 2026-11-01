import { createContext, use, useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Colors, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export type Toast = {
  message: string;
  /** One verb next to the message — in practice "Cofnij". */
  action?: { label: string; onPress: () => void };
};

/** Long enough to read a line; longer when there is something to tap. */
const SHOWN_MS = 4000;
const SHOWN_WITH_ACTION_MS = 6000;

const ToastContext = createContext<(toast: Toast) => void>(() => {});

/**
 * Shows a toast: a line at the bottom of the screen that goes away on its own.
 *
 * For news that needs no answer — "Skopiowano", "Przeniesiono" — where an
 * `Alert` would stop everything until "OK" is tapped. Failures stay alerts:
 * what went wrong must not disappear before it is read.
 */
export const useToast = () => use(ToastContext);

/**
 * Holds the one toast on screen. Lives above the navigator, so a toast
 * survives the screen that raised it closing — the undo after "Przenieś" is
 * still there on the screen you land on.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme() ?? 'light';
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<(Toast & { id: number }) | null>(null);

  // A new toast replaces the old one and starts its own clock; the id is what
  // makes two identical messages in a row two different toasts.
  useEffect(() => {
    if (!toast) return;

    const timer = setTimeout(() => setToast(null), toast.action ? SHOWN_WITH_ACTION_MS : SHOWN_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const show = (next: Toast) => setToast({ ...next, id: Date.now() });

  // Inverted against the screen, the way a snackbar stands out from what it
  // covers; the action takes the other scheme's accent, which is the one
  // readable on that background.
  const inverse = Colors[scheme === 'dark' ? 'light' : 'dark'];

  return (
    <ToastContext value={show}>
      {children}

      {toast ? (
        <View
          pointerEvents="box-none"
          style={[styles.layer, { paddingBottom: insets.bottom + Spacing.three }]}>
          <Pressable
            onPress={() => setToast(null)}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.toast, { backgroundColor: inverse.backgroundElement }]}>
            <ThemedText style={[styles.message, { color: inverse.text }]}>{toast.message}</ThemedText>
            {toast.action ? (
              <Pressable
                onPress={() => {
                  setToast(null);
                  toast.action?.onPress();
                }}
                hitSlop={Spacing.two}
                accessibilityRole="button">
                <ThemedText type="smallBold" style={{ color: inverse.accent }}>
                  {toast.action.label}
                </ThemedText>
              </Pressable>
            ) : null}
          </Pressable>
        </View>
      ) : null}
    </ToastContext>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.three,
  },
  toast: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    borderRadius: Radius.medium,
    elevation: 6,
  },
  message: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
  },
});
