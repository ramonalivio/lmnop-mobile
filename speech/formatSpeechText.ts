import { applyMedicalTerminologyCorrection } from './medicalTerminology';

export function formatSpeechText(text: string, precedingText = '') {
  let formatted = applyMedicalTerminologyCorrection(text.toLowerCase()).replace(
    /\bi\b/g,
    'I',
  );
  formatted = formatted.replace(
    /([.!?]\s+)([a-z])/g,
    (_, boundary, letter) => boundary + letter.toUpperCase(),
  );
  formatted = formatted.replace(
    /\u00b0([cf])\b/g,
    (_, unit) => `\u00b0${unit.toUpperCase()}`,
  );
  if (!precedingText.trim() || /[.!?]\s*$/.test(precedingText)) {
    formatted = formatted.replace(
      /^(\s*["'([]*)([a-z])/,
      (_, prefix, letter) => prefix + letter.toUpperCase(),
    );
  }
  return formatted;
}
