/** Close a stopped dictation without guessing whether it was a question. */
export function finishDictationSentence(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed.trim()) return text;
  const [, body, closing] = trimmed.match(/^(.*?)(["'”’\)\]\}]*$)/s)!;
  if (!/[\p{L}\p{N}]/u.test(body)) return text;
  if (/[.!?…。！？]$/.test(body)) return trimmed;
  return body.replace(/[,;:]?$/, '.') + closing;
}
