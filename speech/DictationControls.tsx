import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export function DictationIcon({
  kind,
}: {
  kind: 'microphone' | 'stop' | 'keyboard';
}) {
  if (kind === 'stop') return <View style={styles.stop} />;
  if (kind === 'keyboard')
    return (
      <View style={styles.keyboard}>
        {[0, 1].map(row => (
          <View key={row} style={styles.keys}>
            {[0, 1, 2, 3, 4].map(key => (
              <View key={key} style={styles.key} />
            ))}
          </View>
        ))}
        <View style={styles.space} />
      </View>
    );
  return (
    <View style={styles.mic}>
      <View style={styles.capsule} />
      <View style={styles.cradle} />
      <View style={styles.stem} />
      <View style={styles.base} />
    </View>
  );
}

export function DictationControls({
  recording,
  cancelAvailable = recording,
  preparing = false,
  showKeyboard,
  disabled,
  label,
  onRecord,
  onCancel,
  cancelLabel = 'Cancel transcription',
  onKeyboard,
}: {
  recording: boolean;
  cancelAvailable?: boolean;
  preparing?: boolean;
  showKeyboard: boolean;
  disabled: boolean;
  label: string;
  onRecord: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
  onKeyboard: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let current = true;
    const animate = (reduce: boolean) => {
      if (!current) return;
      Animated.timing(progress, {
        toValue: showKeyboard ? 1 : 0,
        duration: reduce ? 0 : 240,
        useNativeDriver: false,
      }).start();
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then(animate)
      .catch(() => animate(false));
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      animate,
    );
    return () => {
      current = false;
      progress.stopAnimation();
      subscription.remove();
    };
  }, [progress, showKeyboard]);
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled || preparing}
        accessibilityState={{
          disabled: disabled || preparing,
          busy: preparing,
        }}
        onPress={onRecord}
        style={[
          styles.button,
          styles.primary,
          recording && styles.recording,
          disabled && styles.disabled,
          preparing && styles.preparing,
        ]}
      >
        {preparing ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <DictationIcon kind={recording ? 'stop' : 'microphone'} />
        )}
      </Pressable>
      {cancelAvailable && onCancel && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={cancelLabel}
          onPress={onCancel}
          style={[styles.button, styles.cancel]}
        >
          <Text style={styles.cancelText}>{cancelLabel}</Text>
        </Pressable>
      )}
      <Animated.View
        pointerEvents={showKeyboard ? 'auto' : 'none'}
        accessibilityElementsHidden={!showKeyboard}
        importantForAccessibility={
          showKeyboard ? 'auto' : 'no-hide-descendants'
        }
        style={{
          flexGrow: progress,
          flexBasis: 0,
          minWidth: 0,
          width: 0,
          opacity: progress,
          overflow: 'hidden',
          marginLeft: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, 10],
          }),
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit transcript with keyboard"
          disabled={!showKeyboard || disabled}
          onPress={onKeyboard}
          style={[styles.button, styles.secondary]}
        >
          <DictationIcon kind="keyboard" />
        </Pressable>
      </Animated.View>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  button: {
    minHeight: 58,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { flex: 1, backgroundColor: '#176b5b' },
  secondary: { backgroundColor: '#245aa6' },
  cancel: { marginLeft: 10, paddingHorizontal: 14, backgroundColor: '#e9efee' },
  cancelText: { color: '#344a48', fontSize: 13, fontWeight: '600' },
  recording: { backgroundColor: '#a73d4a' },
  preparing: { backgroundColor: '#a66b12', opacity: 1 },
  disabled: { opacity: 0.45 },
  stop: { width: 21, height: 21, borderRadius: 3, backgroundColor: '#fff' },
  mic: { width: 26, height: 30, alignItems: 'center' },
  capsule: {
    width: 11,
    height: 19,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 7,
  },
  cradle: {
    position: 'absolute',
    top: 10,
    left: 2.5,
    width: 21,
    height: 14,
    borderWidth: 2,
    borderTopWidth: 0,
    borderColor: '#fff',
    borderBottomLeftRadius: 12,
    borderBottomRightRadius: 12,
  },
  stem: { width: 2, height: 7, backgroundColor: '#fff', marginTop: 3 },
  base: {
    position: 'absolute',
    bottom: 0,
    left: 6.5,
    width: 13,
    height: 2,
    backgroundColor: '#fff',
  },
  keyboard: {
    width: 30,
    height: 23,
    borderWidth: 2,
    borderColor: '#fff',
    borderRadius: 3,
    padding: 3,
    gap: 3,
  },
  keys: { flexDirection: 'row', justifyContent: 'space-between' },
  key: { width: 2, height: 2, backgroundColor: '#fff' },
  space: { width: 13, height: 2, backgroundColor: '#fff', alignSelf: 'center' },
});
