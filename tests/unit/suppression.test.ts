import { describe, expect, it } from 'vitest';
import { classifyConsentCommand } from '../../src/domain/suppression.js';

describe('classifyConsentCommand', () => {
  it.each(['STOP', ' stop ', 'STOPALL', 'STOP ALL', 'unsubscribe', 'CANCEL', 'END', 'QUIT'])(
    'classifies %s as opt out',
    (body) => expect(classifyConsentCommand(body)).toBe('opt_out'),
  );

  it.each(['START', ' unstop '])('recognizes %s without clearing suppression', (body) => {
    expect(classifyConsentCommand(body)).toBe('opt_in_claimed');
  });

  it.each(['hello', 'please stop now', ''])('ignores non-command text %s', (body) => {
    expect(classifyConsentCommand(body)).toBe('none');
  });
});
