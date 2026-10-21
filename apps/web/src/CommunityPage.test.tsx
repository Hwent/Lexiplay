import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommunityPage from './CommunityPage';

describe('community coin leaderboard', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('loads public rankings and displays masked names, shared ranks, and formatted balances', async () => {
    let finish!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    vi.stubGlobal('fetch', fetch);
    render(<CommunityPage onExplore={() => {}}/>);
    expect(screen.getByRole('status')).toHaveTextContent('Loading rankings…');
    finish(Response.json([
      { rank: 1, username: 'w***', coinBalance: 1500 },
      { rank: 1, username: 'a***', coinBalance: 1500 },
      { rank: 3, username: 'a***', coinBalance: 900 },
    ]));
    const table = await screen.findByRole('table', { name: 'Coin leaderboard' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1','w***','1,500']);
    expect(within(rows[2]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['1','a***','1,500']);
    expect(within(rows[3]!).getAllByRole('cell').map(cell => cell.textContent)).toEqual(['3','a***','900']);
    expect(fetch).toHaveBeenCalledWith('/api/v1/community/coin-rankings', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('lets users retry a failed request', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ message: 'Could not load the coin leaderboard.' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json([{ rank: 1, username: 'w***', coinBalance: 100 }]));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<CommunityPage onExplore={() => {}}/>);
    expect(await screen.findByText('Rankings are unavailable.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('table', { name: 'Coin leaderboard' })).toHaveTextContent('w***');
    expect(fetch).toHaveBeenCalledTimes(2);
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
