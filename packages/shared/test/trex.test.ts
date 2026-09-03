import { describe, expect, it } from 'vitest';
import { buildTrexManifest, TREX_ICON_BASE64, validateExtensionUrl } from '../src/trex';

describe('validateExtensionUrl', () => {
  it('accepts https URLs and normalizes the trailing slash', () => {
    expect(validateExtensionUrl('https://chat.example.com')).toEqual({
      ok: true,
      url: 'https://chat.example.com/',
    });
    expect(validateExtensionUrl('https://chat.example.com/sub')).toEqual({
      ok: true,
      url: 'https://chat.example.com/sub/',
    });
    expect(validateExtensionUrl(' https://chat.example.com/ ')).toEqual({
      ok: true,
      url: 'https://chat.example.com/',
    });
  });

  it('accepts http only for localhost', () => {
    expect(validateExtensionUrl('http://localhost:5173/').ok).toBe(true);
    expect(validateExtensionUrl('http://127.0.0.1:3000').ok).toBe(true);
    expect(validateExtensionUrl('http://chat.example.com/').ok).toBe(false);
  });

  it('rejects empty, invalid, credentialed and query/fragment URLs', () => {
    for (const raw of [
      '',
      'not-a-url',
      'ftp://chat.example.com/',
      'https://user:pw@chat.example.com/',
      'https://chat.example.com/?x=1',
      'https://chat.example.com/#frag',
    ]) {
      const result = validateExtensionUrl(raw);
      expect(result.ok, raw).toBe(false);
      expect(result.reason, raw).toBeTruthy();
    }
  });
});

describe('buildTrexManifest', () => {
  it('embeds the URL, prod id/name and the icon', () => {
    const xml = buildTrexManifest({ url: 'https://chat.example.com/' });
    expect(xml).toContain('<url>https://chat.example.com/</url>');
    expect(xml).toContain('id="com.openvizpilot.extension"');
    expect(xml).toContain('<text locale="de_DE">OpenVizPilot</text>');
    expect(xml).toContain(TREX_ICON_BASE64);
    expect(xml).not.toContain('{{');
  });

  it('uses the dev id and name in dev mode', () => {
    const xml = buildTrexManifest({ url: 'http://localhost:5173/', dev: true });
    expect(xml).toContain('id="com.openvizpilot.extension.dev"');
    expect(xml).toContain('OpenVizPilot (Dev)');
  });

  it('escapes XML-relevant characters in the URL', () => {
    const xml = buildTrexManifest({ url: 'https://chat.example.com/a&b/' });
    expect(xml).toContain('<url>https://chat.example.com/a&amp;b/</url>');
    expect(xml).not.toContain('a&b');
  });
});
