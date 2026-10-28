import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { clearDictionaryCache } from './dictionary-cache';
import { gameAudio } from './services/game-audio';
import { createTranslator } from './i18n';

beforeEach(() => {
  localStorage.clear(); clearDictionaryCache();
  history.replaceState({}, '', '/settings');
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-CA']);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
    if (path.includes('/word-lists/dictionary?q=')) return Response.json([{ term: 'apple', definition: 'A fruit grown on a tree.', partOfSpeech: ['noun'] }]);
    if (path.endsWith('/collections/game-options/all')) return Response.json([{ wordLength: 5, totalWords: 20, collections: [] }]);
    if (path.endsWith('/wallet')) return Response.json({ coinBalance: 10, kind: 'guest' });
    return Response.json([]);
  }));
});
afterEach(() => { cleanup(); gameAudio.setEnabled(true); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('interface settings', () => {
  it('defaults to dark and remembers an explicitly selected light theme', async () => {
    const user = userEvent.setup();
    const view = render(<App/>);
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByRole('button', { name: 'Dark mode' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Light mode' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('lexiplay-theme')).toBe('light');
    view.unmount();
    render(<App/>);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(screen.getByRole('button', { name: 'Light mode' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('switches the whole interface, preserves English learning content, and restores preferences', async () => {
    const user = userEvent.setup();
    const first = render(<App/>);
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'zh-CN');
    expect(screen.getByRole('heading', { name: '设置', level: 1 })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'zh-CN');
    expect(document.title).toBe('LexiPlay — 学习新单词');
    const size = screen.getByRole('group', { name: '字号' });
    await user.click(within(size).getByRole('button', { name: '小' }));
    expect(document.documentElement).toHaveAttribute('data-font-size', 'small');
    await user.click(within(size).getByRole('button', { name: '标准' }));
    expect(document.documentElement).toHaveAttribute('data-font-size', 'medium');
    await user.click(within(size).getByRole('button', { name: '大' }));
    expect(document.documentElement).toHaveAttribute('data-font-size', 'large');
    await user.click(screen.getByRole('button', { name: '词典' }));
    await user.type(await screen.findByRole('searchbox', { name: '搜索词典' }), 'apple');
    expect(await screen.findByText('A fruit grown on a tree.')).toBeInTheDocument();
    expect(screen.getByText('apple')).toBeInTheDocument();
    expect(screen.getByText('noun')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加 apple' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '游戏' }));
    expect(await screen.findByRole('button', { name: '开始练习' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '经典 Wordle' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '设置' }));
    await user.click(screen.getByRole('link', { name: '反馈' }));
    expect(await screen.findByRole('textbox', { name: '反馈内容' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('navigation', { name: '设置栏目' })).getByRole('link', { name: '账号' }));
    expect(await screen.findByRole('textbox', { name: '用户名或邮箱' })).toBeInTheDocument();
    first.unmount();
    history.replaceState({}, '', '/settings');
    render(<App/>);
    expect(await screen.findByRole('combobox', { name: '语言' })).toHaveValue('zh-CN');
    expect(screen.getByRole('button', { name: '大' })).toHaveAttribute('aria-pressed', 'true');
    await user.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en');
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('lang', 'en');
  });

  it('uses the browser language on a first visit without a manual choice', async () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['zh-CN', 'en-US']);
    render(<App/>);
    expect(await screen.findByRole('combobox', { name: '语言' })).toHaveValue('auto');
    expect(screen.getByRole('heading', { name: '设置', level: 1 })).toBeInTheDocument();
  });

  it('translates formatted messages without changing unknown words or English copy', () => {
    const t = createTranslator('zh-CN');
    expect(t('Page {0} of {1}', 2, 4)).toBe('第 2 / 4 页');
    expect(t('Practice complete. The answer was apple.')).toBe('练习完成，答案是 apple');
    expect(t('You found it! 5 coins earned.')).toBe('猜对了！获得 5 金币');
    expect(t('apple')).toBe('apple');
    expect(t('An unexpected service response')).toBe('An unexpected service response');
    expect(createTranslator('en')('Page {0} of {1}', 2, 4)).toBe('Page 2 of 4');
  });
});
