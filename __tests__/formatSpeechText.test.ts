import { formatSpeechText } from '../speech/formatSpeechText';

test('renders all-caps recognition as sentence case and preserves medical terms', () => {
  expect(
    formatSpeechText('I TAKE METFORMIN. MY MRI AND HBA1C ARE NORMAL.'),
  ).toBe('I take metformin. My MRI and HbA1c are normal.');
  expect(formatSpeechText('METFORMIN HELPS')).toBe('Metformin helps');
});

test('a provisional phrase continues the confirmed sentence across a pause', () => {
  expect(formatSpeechText('EVERY DAY', 'I TAKE METFORMIN')).toBe('every day');
  expect(formatSpeechText('I FEEL BETTER', 'THE MRI IS NORMAL.')).toBe(
    'I feel better',
  );
  expect(formatSpeechText('')).toBe('');
});
