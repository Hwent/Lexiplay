import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import SafariInstallGuide from './SafariInstallGuide';

afterEach(cleanup);

it('opens the screenshot guide and navigates all four steps in either direction', async () => {
  const user = userEvent.setup();
  render(<SafariInstallGuide/>);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  await user.click(screen.getByText('Add to Home Screen'));
  expect(await screen.findByRole('img', { name: 'Step 1: Tap More in Safari.' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous step' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Next step' }));
  expect(screen.getByRole('img', { name: 'Step 2: Tap Share.' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next step' }));
  expect(screen.getByRole('img', { name: 'Step 3: Choose Add to Home Screen.' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Next step' }));
  expect(screen.getByRole('img', { name: 'Step 4: Turn on Open as Web App, then tap Add.' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next step' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Previous step' }));
  expect(screen.getByRole('img', { name: 'Step 3: Choose Add to Home Screen.' })).toBeInTheDocument();
  await user.click(screen.getByText('Add to Home Screen'));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
