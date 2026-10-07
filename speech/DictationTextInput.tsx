import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

export function DictationTextInput({
  editorId,
  ...props
}: TextInputProps & { editorId: string }) {
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const [typing, setTyping] = useState(false);
  const accessoryId = `${editorId}-keyboard`;
  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (!input.current?.isFocused()) setTyping(false);
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (typing) {
      // Refocus after enabling the keyboard when selection already owns focus.
      input.current?.blur();
      const frame = requestAnimationFrame(() => input.current?.focus());
      return () => cancelAnimationFrame(frame);
    }
  }, [typing]);
  const dismiss = () => {
    setTyping(false);
    Keyboard.dismiss();
  };
  return (
    <View>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            typing ? `Done typing ${editorId}` : `Type ${editorId}`
          }
          onPress={() => (typing ? dismiss() : setTyping(true))}
          style={styles.button}
        >
          <Text style={styles.label}>{typing ? 'Done' : 'Type'}</Text>
        </Pressable>
      </View>
      <TextInput
        {...props}
        ref={input}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        autoComplete="off"
        textContentType="none"
        smartInsertDelete={false}
        showSoftInputOnFocus={typing}
        inputAccessoryViewID={accessoryId}
      />
      {Platform.OS === 'ios' && typing && (
        <InputAccessoryView nativeID={accessoryId}>
          <View style={styles.accessory}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hide keyboard"
              onPress={dismiss}
              style={styles.button}
            >
              <Text style={styles.label}>Done</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { alignItems: 'flex-end' },
  button: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  label: { color: '#245a50', fontSize: 16, fontWeight: '600' },
  accessory: {
    backgroundColor: '#f1f4f3',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#bac5c2',
    alignItems: 'flex-end',
  },
});
