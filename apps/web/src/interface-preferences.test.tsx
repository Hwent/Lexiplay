import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readInterfacePreferences, resolveLanguage, useInterfacePreferences } from './interface-preferences';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('interface preferences', () => {
  it('matches browser language preferences and respects manual selection', () => {
    expect(resolveLanguage('auto', ['zh-CN', 'en-US'])).toBe('zh-CN');
    expect(resolveLanguage('auto', ['en-CA', 'zh-CN'])).toBe('en');
    expect(resolveLanguage('auto', ['fr-CA'])).toBe('en');
    expect(resolveLanguage('en', ['zh-CN'])).toBe('en');
    expect(resolveLanguage('zh-CN', ['en-US'])).toBe('zh-CN');
  });

  it('applies language and font size, then restores them after reopening', () => {
    const browserLanguages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN']);
    const { result, unmount } = renderHook(useInterfacePreferences);
    expect(document.documentElement).toHaveAttribute('lang', 'zh-CN');
    expect(document.documentElement).toHaveAttribute('data-font-size', 'medium');
    act(() => { result.current.setLanguage('en'); result.current.setFontSize('large'); });
    expect(document.documentElement).toHaveAttribute('lang', 'en');
    expect(document.documentElement).toHaveAttribute('data-font-size', 'large');
    unmount();
    const restored = renderHook(useInterfacePreferences);
    expect(restored.result.current.languagePreference).toBe('en');
    expect(restored.result.current.fontSize).toBe('large');
    act(() => restored.result.current.setLanguage('auto'));
    expect(restored.result.current.language).toBe('zh-CN');
    browserLanguages.mockReturnValue(['en-CA']);
    act(() => window.dispatchEvent(new Event('languagechange')));
    expect(restored.result.current.language).toBe('en');
  });

  it('uses defaults when stored preferences are invalid', () => {
    localStorage.setItem('lexiplay-interface-preferences', '{');
    expect(readInterfacePreferences()).toEqual({ language: 'auto', fontSize: 'medium' });
    localStorage.setItem('lexiplay-interface-preferences', JSON.stringify({ language: 'fr', fontSize: 'huge' }));
    expect(readInterfacePreferences()).toEqual({ language: 'auto', fontSize: 'medium' });
  });
});
