import {
  audioPauses,
  punctuatePauses,
  finishSentence,
} from '../speech/pausePunctuation';

test('detects internal quiet pauses from PCM without treating trailing silence as a boundary', () => {
  const pcm = new Float32Array(3000);
  pcm.fill(0.1, 0, 500);
  pcm.fill(0.1, 1200, 1800);
  expect(audioPauses(pcm, 1000)).toEqual([{ startMs: 500, endMs: 1200 }]);
});
test('short pauses add commas and longer pauses add periods and capitals', () => {
  const segments = [
    { text: 'Patient is alert', t0: 0, t1: 100 },
    { text: ' no distress', t0: 170, t1: 250 },
    { text: ' heart rate normal', t0: 380, t1: 500 },
  ];
  expect(
    punctuatePauses(
      'Patient is alert no distress heart rate normal',
      segments,
      [
        { startMs: 1000, endMs: 1700 },
        { startMs: 2500, endMs: 3800 },
      ],
    ),
  ).toBe('Patient is alert, no distress. Heart rate normal');
});
test('preserves existing punctuation and refuses inconsistent text alignment', () => {
  expect(
    punctuatePauses(
      'Alert. No distress',
      [
        { text: 'Alert.', t0: 0, t1: 100 },
        { text: ' No distress', t0: 250, t1: 400 },
      ],
      [{ startMs: 1000, endMs: 2500 }],
    ),
  ).toBe('Alert. No distress');
  expect(
    punctuatePauses('Amlodipine', [{ text: 'different', t0: 0, t1: 1 }], []),
  ).toBe('Amlodipine');
});
test('never inserts punctuation inside a medication token or number-unit expression', () => {
  expect(
    punctuatePauses(
      'amlodipine',
      [
        { text: 'amlo', t0: 0, t1: 100 },
        { text: 'dipine', t0: 240, t1: 300 },
      ],
      [{ startMs: 1000, endMs: 2400 }],
    ),
  ).toBe('amlodipine');
  expect(
    punctuatePauses(
      '38.1 degrees Celsius',
      [
        { text: '38.1', t0: 0, t1: 100 },
        { text: ' degrees Celsius', t0: 240, t1: 300 },
      ],
      [{ startMs: 1000, endMs: 2400 }],
    ),
  ).toBe('38.1 degrees Celsius');
});
test('Stop adds a sentence ending without altering decimals or existing punctuation', () => {
  expect(finishSentence('temperature 38.1°C')).toBe('Temperature 38.1°C.');
  expect(finishSentence('Already done!')).toBe('Already done!');
});
