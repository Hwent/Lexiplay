import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommunityPage from './CommunityPage';

describe('community coin leaderboard', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('defaults to practice rankings with full names, shared ranks, and formatted counts', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    render(<CommunityPage onExplore={() => {}}/>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading rankings…');
    finish(Response.json([
      { rank: 1, username: 'William_abcdefghijklmnopqrstuvwxyz', value: 1500 },
      { rank: 1, username: 'alice', value: 1500 },
      { rank: 3, username: '学习者', value: 900 },
    ]));
    const table = await screen.findByRole('table', { name: 'Practice leaderboard' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1','William_abcdefghijklmnopqrstuvwxyz','1,500']);
    expect(screen.getByTitle('William_abcdefghijklmnopqrstuvwxyz')).toHaveTextContent('William_abcdefghijklmnopqrstuvwxyz');
    expect(within(rows[2]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1','alice','1,500']);
    expect(within(rows[3]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['3','学习者','900']);
    expect(fetch).toHaveBeenCalledWith('/api/v1/community/practice-rankings', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('lets users retry a failed request', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ message: 'Could not load the coin leaderboard.' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json([{ rank: 1, username: 'William', value: 100 }]));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<CommunityPage onExplore={() => {}}/>);
    expect(await screen.findByText('Rankings are unavailable.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Practice leaderboard' })).toHaveTextContent('William');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('orders practice, streak, and coin tabs and supports keyboard switching', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => Response.json(String(input).endsWith('/coin-rankings')
      ? [{ rank: 1, username: 'Alice', coinBalance: 2500 }] : [{ rank: 1, username: 'Bob', value: 3 }])));
    const user = userEvent.setup();
    render(<CommunityPage onExplore={() => {}}/>);
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Practice count','Streak days','Coins']);
    await screen.findByRole('table', { name: 'Practice leaderboard' });
    await user.click(screen.getByRole('tab', { name: 'Practice count' }));
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Streak days' })).toHaveFocus();
    expect(await screen.findByRole('table', { name: 'Streak leaderboard' })).toHaveTextContent('3');
    await user.keyboard('{End}');
    expect(await screen.findByRole('table', { name: 'Coin leaderboard' })).toHaveTextContent('2,500');
  });

  it('shows an empty state and keeps vocabulary navigation available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
    const explore = vi.fn(), user = userEvent.setup();
    render(<CommunityPage onExplore={explore}/>);
    expect(await screen.findByText('No rankings yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Explore vocabulary' }));
    expect(explore).toHaveBeenCalledOnce();
  });
});
