import { finishDictationSentence } from '../speech/finishDictationSentence';

test.each([
  ['Patient is stable', 'Patient is stable.'],
  ['Temperature 38.1', 'Temperature 38.1.'],
  ['Patient is stable. ', 'Patient is stable.'],
  ['Any pain?', 'Any pain?'],
  ['Stop!', 'Stop!'],
  ['Still waiting…', 'Still waiting…'],
  ['Stable,', 'Stable.'],
  ['He said “no pain”', 'He said “no pain.”'],
  ['He asked “any pain?”', 'He asked “any pain?”'],
  ['', ''],
  ['   ', '   '],
])('finishes %j as %j', (input, expected) => {
  expect(finishDictationSentence(input)).toBe(expected);
});
