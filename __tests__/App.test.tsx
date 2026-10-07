/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App, {parseAuthCallback} from '../App';
import {applyMedicalTerminologyCorrection} from '../speech/medicalTerminology';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});

test('parses iOS auth callback without including URL fragment in session token', () => {
  const callback = parseAuthCallback(
    'lmnop://auth/callback?status=ok&email=test%40example.com&session_token=iv.encrypted#',
  );

  expect(callback).toEqual({
    email: 'test@example.com',
    sessionToken: 'iv.encrypted',
    status: 'ok',
  });
});

test('ignores non-empty auth callback fragments', () => {
  expect(
    parseAuthCallback(
      'lmnop://auth/callback?status=ok&email=test%40example.com&session_token=iv.encrypted#unexpected',
    ),
  ).toEqual({
    email: 'test@example.com',
    sessionToken: 'iv.encrypted',
    status: 'ok',
  });
});

test('parses custom scheme callback when React Native URL omits host and path', () => {
  const callback = parseAuthCallback(
    'lmnop:/?status=ok&email=test%40example.com&session_token=iv.encrypted#',
  );

  expect(callback).toEqual({
    email: 'test@example.com',
    sessionToken: 'iv.encrypted',
    status: 'ok',
  });
});

test('normalizes common medical terminology in speech transcripts', () => {
  expect(
    applyMedicalTerminologyCorrection(
      'patient mentioned hippa and a 1 c while taking met form in',
    ),
  ).toBe('patient mentioned HIPAA and A1C while taking metformin');
});
