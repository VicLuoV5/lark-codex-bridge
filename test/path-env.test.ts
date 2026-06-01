import { describe, expect, it } from 'vitest';
import { prependPathSegment, windowsNpmGlobalBin, withWindowsNpmGlobalBin } from '../src/runtime/path-env';

describe('Windows tool PATH helpers', () => {
  it('adds the npm global bin from APPDATA to Windows Path', () => {
    const env = withWindowsNpmGlobalBin(
      {
        APPDATA: 'C:\\Users\\Me\\AppData\\Roaming',
        Path: 'C:\\Windows\\System32',
      },
      'win32',
    );

    expect(env.Path).toBe('C:\\Users\\Me\\AppData\\Roaming\\npm;C:\\Windows\\System32');
  });

  it('normalizes duplicate Windows path keys so the injected Path is used', () => {
    const env = withWindowsNpmGlobalBin(
      {
        APPDATA: 'C:\\Users\\Me\\AppData\\Roaming',
        PATH: 'C:\\Windows\\System32',
      },
      'win32',
    );

    expect(env.Path).toBe('C:\\Users\\Me\\AppData\\Roaming\\npm;C:\\Windows\\System32');
    expect(env.PATH).toBeUndefined();
  });

  it('does not duplicate an existing npm global bin path', () => {
    const env = withWindowsNpmGlobalBin(
      {
        APPDATA: 'C:\\Users\\Me\\AppData\\Roaming',
        Path: 'c:\\users\\me\\appdata\\roaming\\npm;C:\\Windows\\System32',
      },
      'win32',
    );

    expect(env.Path).toBe('c:\\users\\me\\appdata\\roaming\\npm;C:\\Windows\\System32');
  });

  it('leaves non-Windows environments unchanged', () => {
    const env = { APPDATA: '/tmp/appdata', PATH: '/usr/bin' };

    expect(withWindowsNpmGlobalBin(env, 'linux')).toEqual(env);
    expect(windowsNpmGlobalBin(env, 'linux')).toBeUndefined();
  });

  it('prepends generic PATH segments idempotently', () => {
    expect(prependPathSegment('/bin:/usr/bin', '/opt/bin', ':', false)).toBe('/opt/bin:/bin:/usr/bin');
    expect(prependPathSegment('/opt/bin:/bin', '/opt/bin/', ':', false)).toBe('/opt/bin:/bin');
  });
});
