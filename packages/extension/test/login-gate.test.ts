import { describe, expect, it } from 'vitest';
import { getLoginFieldErrors } from '../src/ui/LoginGate';

// UI-Review P2-8: leere Zugangsdaten müssen am jeweiligen Feld erklärt werden
// statt in einem stillen return zu enden.
describe('getLoginFieldErrors', () => {
  it('returns no errors for a filled-out form', () => {
    expect(getLoginFieldErrors('alice', 'secret')).toEqual({});
  });

  it('flags an empty or whitespace-only username', () => {
    expect(getLoginFieldErrors('', 'secret').username).toBeTruthy();
    expect(getLoginFieldErrors('   ', 'secret').username).toBeTruthy();
    expect(getLoginFieldErrors('', 'secret').password).toBeUndefined();
  });

  it('flags an empty password', () => {
    expect(getLoginFieldErrors('alice', '').password).toBeTruthy();
    expect(getLoginFieldErrors('alice', '').username).toBeUndefined();
  });

  it('flags both fields when both are empty', () => {
    const errors = getLoginFieldErrors('', '');
    expect(errors.username).toBeTruthy();
    expect(errors.password).toBeTruthy();
  });
});
