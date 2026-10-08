import { normalizeClinicalText } from '../speech/normalizeClinicalText';

test.each([
  ['Metformin 500 milligrams twice daily', 'Metformin 500mg twice daily'],
  ['1 milligram and 2.5 MILLIGRAMS', '1mg and 2.5mg'],
  ['875/125 milligrams', '875/125mg'],
  [
    'Amoxicillin clavulanate 875 over 125 milligrams',
    'Amoxicillin clavulanate 875 over 125mg',
  ],
  ['Temperature is 38.1 Degrees Celsius', 'Temperature is 38.1\u00b0C'],
  ['100.6 degrees Fahrenheit', '100.6\u00b0F'],
  ['38.1 Celsius and 98.6 degree F', '38.1\u00b0C and 98.6\u00b0F'],
  ['Blood pressure 132 over 84', 'Blood pressure 132/84'],
  ['BP is 120 over 80. BP: 90 over 60', 'BP is 120/80. BP: 90/60'],
  ['54 year old male', '54-year-old male'],
  ['54 years old, 1.5 year old', '54-year-old, 1.5-year-old'],
])('normalizes %s without altering values', (input, expected) => {
  expect(normalizeClinicalText(input)).toBe(expected);
  expect(normalizeClinicalText(expected)).toBe(expected);
});

test.each([
  'Oxygen saturation 95 on room air',
  'Temperature 38.1 degrees',
  '132 over 84',
  '500 micrograms, 5 grams, 5 milliliters',
  '500mg',
  'No chest pain. Heart rate 96.',
  'Over 54 years of experience',
])('leaves ambiguous or unrelated text unchanged: %s', input => {
  expect(normalizeClinicalText(input)).toBe(input);
});
