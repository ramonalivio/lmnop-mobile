import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native';

const heights = [10, 18, 24, 16, 10];

export function RecordingIndicator({
  active,
  level,
}: {
  active: boolean;
  level?: number;
}) {
  const recentLevels = useRef(heights.map(() => 0.1));
  const bars = useRef(heights.map(() => new Animated.Value(1))).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(enabled => {
        if (mounted) {
          setReduceMotion(enabled);
        }
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!active || reduceMotion) {
      bars.forEach(bar => bar.setValue(1));
      return;
    }
    if (level !== undefined) {
      recentLevels.current = [
        ...recentLevels.current.slice(1),
        Math.max(0.08, Math.min(1, level)),
      ];
      const animations = bars.map((bar, index) =>
        Animated.timing(bar, {
          toValue: recentLevels.current[index],
          duration: 90,
          useNativeDriver: true,
          isInteraction: false,
        }),
      );
      animations.forEach(animation => animation.start());
      return () => animations.forEach(animation => animation.stop());
    }
    const animations = bars.map((bar, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 0.3,
            duration: 220 + index * 45,
            useNativeDriver: true,
            isInteraction: false,
          }),
          Animated.timing(bar, {
            toValue: 1,
            duration: 280 + index * 30,
            useNativeDriver: true,
            isInteraction: false,
          }),
        ]),
      ),
    );
    animations.forEach(animation => animation.start());
    return () => {
      animations.forEach(animation => animation.stop());
    };
  }, [active, bars, reduceMotion, level]);

  return (
    <View
      style={[styles.indicator, !active && styles.hidden]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {bars.map((bar, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              height: level === undefined ? heights[index] : 24,
              transform: [{ scaleY: bar }],
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  indicator: {
    width: 40,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  bar: { width: 4, borderRadius: 2, backgroundColor: '#176b5b' },
});
