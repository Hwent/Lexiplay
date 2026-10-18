import { stubFetchWithVocabularyRanges } from './vocabulary-range-test-fixtures';
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
      if (path.endsWith('/progress/claim')) return Response.json({ wordsAdded: 0, wordsAlreadySaved: 0, gamesTransferred: 0, resumeGameId: null });
      if (path.endsWith('/auth/login')) return Response.json({ user: account });
      if (path.endsWith('/auth/logout')) return new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${path}`);
    });
    stubFetchWithVocabularyRanges(fetchMock); const user = userEvent.setup(); render(<App />);
    expect(await screen.findByText(/^Guest/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Forgot password?' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Account' }));
    expect(window.location.pathname).toBe('/account');
    const page = await screen.findByRole('region', { name: 'Account management' });
    await user.type(within(page).getByLabelText('Username or email'), 'learner');
    await user.type(within(page).getByLabelText('Password'), 'password8');
    await user.click(within(page).getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Signed in as learner')).toBeInTheDocument();
    expect(screen.getByText('Email not verified · optional')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'LexiPlay home' }));
    expect(screen.getByRole('link', { name: 'Account' })).toHaveTextContent('learnerSigned in');
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send verification link' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText(/^Guest/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/auth/me'))).toHaveLength(1);
  });
  it('opens the account page directly and retries a failed session lookup', async () => {
    window.history.replaceState({}, '', '/account');
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    stubFetchWithVocabularyRanges(fetchMock); const user = userEvent.setup(); render(<App />);
    expect(await screen.findByText('Could not load your account. Please try again.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Username or email')).toBeInTheDocument();
    expect(screen.getByText(/^Guest/)).toBeInTheDocument();
  });
  it('opens reset links on Account, removes the token, and updates an eight-character password', async () => {
    window.history.replaceState({}, '', '/account#action=reset&token=' + 'a'.repeat(43));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me') ? new Response('{}', { status: 401 }) : Response.json({ message: 'Password updated. Sign in with your new password.' }));
    stubFetchWithVocabularyRanges(fetchMock); const user = userEvent.setup(); render(<App />);
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
    stubFetchWithVocabularyRanges(fetchMock); const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Verify email address' }));
    await waitFor(() => expect(screen.getByText('Email not verified · optional')).toBeInTheDocument());
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });
  it('creates an account without email and toggles password visibility without submitting', async () => {
    window.history.replaceState({}, '', '/account');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me')
      ? new Response('{}', { status: 401 })
      : String(input).endsWith('/progress/claim') ? Response.json({ wordsAdded: 0, wordsAlreadySaved: 0, gamesTransferred: 0, resumeGameId: null }) : Response.json({ user: { id: 'user-1', username: 'learner', email: null, emailVerified: false }, verificationSent: false }));
    stubFetchWithVocabularyRanges(fetchMock); const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('tab', { name: 'Create account' }));
    expect(screen.getByLabelText('Email optional')).not.toBeRequired();
    expect(screen.getByRole('checkbox')).not.toBeChecked(); expect(screen.getByRole('checkbox')).toBeDisabled();
    await user.type(screen.getByLabelText('Username'), 'learner');
    const password = screen.getByLabelText('Password'); await user.type(password, 'password8');
    expect(password).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password).toHaveAttribute('type', 'password'); expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Account created. You’re ready to practise.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/register', expect.objectContaining({ body: JSON.stringify({ username: 'learner', password: 'password8', sendVerification: false }) }));
    expect(screen.getByText('Not added')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send verification link' })).not.toBeInTheDocument();
  });
  it('offers verification only when explicitly selected during signup', async () => {
    window.history.replaceState({}, '', '/account');
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/auth/me')
      ? new Response('{}', { status: 401 })
      : String(input).endsWith('/progress/claim') ? Response.json({ wordsAdded: 0, wordsAlreadySaved: 0, gamesTransferred: 0, resumeGameId: null }) : Response.json({ user: { id: 'user-1', username: 'learner', email: 'learner@example.test', emailVerified: false }, verificationSent: true }));
    stubFetchWithVocabularyRanges(fetchMock); const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('tab', { name: 'Create account' }));
    await user.type(screen.getByLabelText('Username'), 'learner');
    await user.type(screen.getByLabelText('Email optional'), 'learner@example.test');
    await user.type(screen.getByLabelText('Password'), 'password8');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await user.click(screen.getByRole('checkbox')); await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Account created. Check your email for the optional verification link.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/register', expect.objectContaining({ body: JSON.stringify({ email: 'learner@example.test', username: 'learner', password: 'password8', sendVerification: true }) }));
  });
  it('adds a recovery address with the current password and opens the recovery confirmation', async () => {
    window.history.replaceState({}, '', '/account');
    const account = { id: 'user-1', username: 'learner', email: null, emailVerified: false };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return Response.json(account);
      if (path.endsWith('/auth/email')) return Response.json({ user: { ...account, email: 'learner@example.test' } });
      if (path.endsWith('/auth/forgot-password')) return Response.json({ message: 'If that email has an account, a reset link will arrive shortly.' });
      throw new Error(`Unexpected request: ${path}`);
    });
    stubFetchWithVocabularyRanges(fetchMock); const user = userEvent.setup(); render(<App />);
    await user.type(await screen.findByLabelText('Recovery email'), 'learner@example.test');
    await user.type(screen.getByLabelText('Current password'), 'password8');
    await user.click(screen.getByRole('button', { name: 'Add recovery email' }));
    expect(await screen.findByText('Recovery email added. Verification is optional.')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/email', expect.objectContaining({ body: JSON.stringify({ email: 'learner@example.test', password: 'password8' }) }));
    await user.click(screen.getByRole('button', { name: 'Reset your password' }));
    expect(screen.getByLabelText('Email')).toHaveValue('learner@example.test');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Check your inbox')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/forgot-password', expect.objectContaining({ body: JSON.stringify({ email: 'learner@example.test' }) }));
    await user.click(screen.getByRole('button', { name: 'Back to account' }));
    expect(screen.getByText('Signed in as learner')).toBeInTheDocument();
  });
  it('requires deletion confirmation, preserves the account on failure, and clears it on success', async () => {
    window.history.replaceState({}, '', '/account');
    const account = { id: 'user-1', username: 'learner', email: 'learner@example.test', emailVerified: false };
    let attempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/auth/me')) return Response.json(account);
      if (path.endsWith('/auth/account')) return ++attempts === 1 ? Response.json({ message: 'Your current password is incorrect.' }, { status: 401 }) : new Response(null, { status: 204 });
      throw new Error(`Unexpected request: ${path}`);
    });
    stubFetchWithVocabularyRanges(fetchMock); const user = userEvent.setup(); render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Delete account' }));
    expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeDisabled();
    await user.type(screen.getByLabelText('Current password'), 'password8');
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Keep my account' }));
    expect(attempts).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Delete account' }));
    expect(screen.getByLabelText('Current password')).toHaveValue('');
    expect(screen.getByLabelText('Type DELETE to confirm')).toHaveValue('');
    await user.type(screen.getByLabelText('Current password'), 'password8');
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delete');
    expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Type DELETE to confirm')); await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Permanently delete account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current password is incorrect.');
    expect(screen.getByText('Signed in as learner')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Permanently delete account' }));
    expect(await screen.findByText('Your account and saved learning data have been deleted.')).toBeInTheDocument();
    expect(screen.getByText(/^Guest/)).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/account', expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ password: 'password8', confirmation: 'DELETE' }) }));
  });
});
