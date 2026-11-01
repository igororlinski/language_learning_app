import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/** How long the bars and rings take to grow in. */
export const ENTRANCE_MS = 700;

/** Waits out the screen's own slide-in, so the growing is seen. */
const ENTRANCE_DELAY_MS = 150;

/**
 * 0 → 1 once, when the component mounts: what the bars and the rings on
 * "Statystyki" grow by on the way into the screen. A transform on the native
 * driver, like the side menu's slide, so it costs the JS thread nothing.
 *
 * With "reduce motion" on in the phone's settings, 1 at once.
 */
export function useEntrance(): Animated.Value {
  const [value] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let live = true;
    let animation: Animated.CompositeAnimation | null = null;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!live) return;

      if (reduce) {
        value.setValue(1);
        return;
      }

      animation = Animated.timing(value, {
        toValue: 1,
        duration: ENTRANCE_MS,
        delay: ENTRANCE_DELAY_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      });
      animation.start();
    });

    return () => {
      live = false;
      animation?.stop();
    };
  }, [value]);

  return value;
}
