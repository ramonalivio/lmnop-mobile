import { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet } from 'react-native';

/** End-to-end wait including capture drain, network and refinement. */
export function RefinementTimer({
  active,
  reset,
}: {
  active: boolean;
  reset: boolean;
}) {
  const started = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  useEffect(() => {
    if (reset) {
      started.current = null;
      setElapsed(null);
    }
  }, [reset]);
  useEffect(() => {
    if (!active) {
      if (started.current !== null) {
        setElapsed((Date.now() - started.current) / 1000);
        started.current = null;
      }
      return;
    }
    started.current = Date.now();
    setElapsed(0);
    const timer = setInterval(
      () => setElapsed((Date.now() - started.current!) / 1000),
      100,
    );
    return () => clearInterval(timer);
  }, [active]);
  if (elapsed === null) return null;
  return (
    <Text accessibilityLabel="Refinement duration" style={styles.counter}>
      {active ? 'Refining' : 'Refinement finished'} · {elapsed.toFixed(1)}s
    </Text>
  );
}

const styles = StyleSheet.create({
  counter: { color: '#53615f', fontSize: 14 },
});
