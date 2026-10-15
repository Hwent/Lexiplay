import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import CollectionPicker from './CollectionPicker';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('offers available official collections directly without pool subscriptions', async () => {
  const fetchMock = vi.fn(async () => Response.json([
    { id: 'a2', slug: 'cefr-a2', name: 'CEFR A2', status: 'available' },
    { id: 'c2', slug: 'cefr-c2', name: 'CEFR C2', status: 'available' },
    { id: 'exam', slug: 'ielts-core', name: 'IELTS Core', status: 'awaiting_data' },
  ]));
  vi.stubGlobal('fetch', fetchMock);
  const onChange = vi.fn(), user = userEvent.setup();
  render(<CollectionPicker value="" disabled={false} onChange={onChange} onOpenLibrary={() => {}}/>);
  await screen.findByRole('option', { name: 'CEFR C2' });
  expect(screen.queryByRole('option', { name: 'IELTS Core' })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Official collection'), 'cefr-c2');
  expect(onChange).toHaveBeenCalledWith('cefr-c2');
  expect(fetchMock).toHaveBeenCalledWith('/api/v1/collections', expect.anything());
});
