import { useRef, useState, type ComponentRef } from 'react';
import {
  Keyboard,
  NativeModules,
  findNodeHandle,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { ReplacementSelection } from './VoiceReplacement';

export function TranscriptEditor({
  selection,
  onDone,
}: {
  selection: ReplacementSelection;
  onDone: (selection: ReplacementSelection) => void;
}) {
  const [text, setText] = useState(selection.source);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const initialRange = useRef({
    start: Math.min(selection.start, selection.source.length),
    end: Math.min(selection.end, selection.source.length),
  });
  const [range, setRange] = useState(initialRange.current);
  const [shown, setShown] = useState(false);
  const restored = useRef(false);
  const closing = useRef(false);
  const keyboardRequested = useRef(false);
  const done = () => {
    if (closing.current) return;
    closing.current = true;
    Keyboard.dismiss();
    onDone({
      source: text,
      start: Math.min(range.start, text.length),
      end: Math.min(range.end, text.length),
    });
  };
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={done}
      onShow={() => setShown(true)}
    >
      <SafeAreaProvider>
        <SafeAreaView style={styles.page}>
          <KeyboardAvoidingView
            style={styles.page}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.toolbar}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Done editing transcript"
                onPress={done}
                style={styles.done}
              >
                <Text style={styles.doneText}>Done</Text>
              </Pressable>
            </View>
            {shown && (
              <TextInput
                ref={input}
                accessibilityLabel="Edit transcript"
                multiline
                autoFocus
                onLayout={() => {
                  if (Platform.OS !== 'android' || keyboardRequested.current)
                    return;
                  const tag = findNodeHandle(input.current);
                  if (tag != null) {
                    keyboardRequested.current = true;
                    NativeModules.TranscriptKeyboard?.show(tag);
                  }
                }}
                showSoftInputOnFocus
                selection={range}
                onFocus={() => {
                  if (!restored.current)
                    input.current?.setNativeProps({
                      selection: initialRange.current,
                    });
                }}
                onTouchStart={() => {
                  restored.current = true;
                }}
                scrollEnabled
                value={text}
                onChangeText={next => {
                  restored.current = true;
                  setText(next);
                }}
                onSelectionChange={event => {
                  const next = event.nativeEvent.selection;
                  if (!restored.current) {
                    if (
                      next.start !== initialRange.current.start ||
                      next.end !== initialRange.current.end
                    )
                      return;
                    restored.current = true;
                  }
                  setRange(next);
                }}
                style={styles.editor}
                textAlignVertical="top"
                autoCorrect={false}
                spellCheck={false}
                placeholder="Enter transcript"
              />
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  toolbar: { alignItems: 'flex-end', paddingHorizontal: 12 },
  done: {
    minHeight: 44,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneText: { color: '#176b5b', fontSize: 17, fontWeight: '600' },
  editor: {
    flex: 1,
    fontSize: 17,
    lineHeight: 25,
    color: '#172b27',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
});
