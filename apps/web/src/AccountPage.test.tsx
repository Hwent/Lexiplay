import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

describe('dedicated account page', () => {
  beforeEach(() => { window.localStorage.clear(); window.history.replaceState({}, '', '/'); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it('keeps forms off the main page and shares sign-in status across page navigation', async () => {
    const account = { id: 'user-1', email: 'learner@example.test', username: 'learner', emailVerified: false };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return new Response('{}', { status: 401 });
      if (path.endsWith('/auth/login')) return Response.json({ user: account });
      if (path.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${path}`);
    });
    vi.stubGlobal('fetch', fetchMock); const user = userEvent.setup(); render(<App />);
    expect(await screen.findByText('Guest')).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Account' }));
    expect(window.location.pathname).toBe('/account');
    const page = screen.getByRole('region', { name: 'Account management' });
    await user.type(within(page).getByLabelText('Username or email'), 'learner');
    await user.type(within(page).getByLabelText('Password'), 'password8');
    await user.click(within(page).getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Signed in as learner')).toBeInTheDocument();
    expect(screen.getByText('Email verification pending')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('link', { name: 'Account' })).toHaveTextContent('learnerSigned in');
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend verification email' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Guest')).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/auth/me'))).toHaveLength(1);
  });
  it('opens the account page directly and retries a failed session lookup', async () => {
    window.history.replaceState({}, '', '/account');
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock); const user = userEvent.setup(); render(<App />);
    expect(await screen.findByText('Could not load your account. Please try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(screen.getByText('Guest')).toBeInTheDocument();
  });
  it('opens reset links on Account, removes the token, and updates an eight-character password', async () => {
    window.history.replaceState({}, '', '/account#action=reset&token=' + 'a'.repeat(43));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json({ message: 'Password updated. Sign in with your new password.' }));
    vi.stubGlobal('fetch', fetchMock); const user = userEvent.setup(); render(<App />);
    const input = await screen.findByLabelText('New password');
    expect(window.location.hash).toBe(''); expect(window.location.pathname).toBe('/account');
    await user.type(input, 'newpass8'); await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Password updated. Sign in with your new password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Username or email')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/reset-password', expect.objectContaining({ body: JSON.stringify({ token: 'a'.repeat(43), password: 'newpass8' }) }));
  });
  it('does not mark the current account verified when a link verifies a different account', async () => {
    window.history.replaceState({}, '', '/account#action=verify&token=' + 'b'.repeat(43));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? Response.json({ id: 'user-2', email: 'other@example.test', username: 'other', emailVerified: false }) : Response.json({ message: 'Your email is verified.' }));
    vi.stubGlobal('fetch', fetchMock); const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Verify my email' }));
    await waitFor(() => expect(screen.getByText('Email verification pending')).toBeInTheDocument());
    expect(screen.queryByText('Email verified')).not.toBeInTheDocument();
  });
});
