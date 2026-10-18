import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import AccountStatus from './AccountStatus';
import coinImage from './assets/lexi-coin.svg';

describe('account coin balance', () => {
  afterEach(cleanup);
  const account = { id: 'learner', email: null, username: 'learner', coinBalance: 500 };
  const props = { account, loading: false, error: '', onOpen: () => {} };

  it('shows stored coins beside the account and keeps zero visible', () => {
    const { rerender } = render(<AccountStatus {...props} coinBalance={500}/>);
    const balance = screen.getByLabelText('Coin balance: 500');
    expect(balance).toHaveTextContent('500');
    expect(balance.querySelector('img.coin-icon')).toHaveAttribute('src', coinImage);
    expect(screen.getByRole('link', { name: 'Account' })).not.toContainElement(balance);
    rerender(<AccountStatus {...props} coinBalance={0}/>);
    expect(screen.getByLabelText('Coin balance: 0')).toHaveTextContent('0');
  });

  it('shows the guest wallet and hides unknown or failed balances', () => {
    const { rerender } = render(<AccountStatus {...props} account={null} coinBalance={10}/>);
    expect(screen.getByLabelText('Coin balance: 10')).toBeInTheDocument();
    rerender(<AccountStatus {...props}/>);
    expect(screen.queryByLabelText(/Coin balance:/)).not.toBeInTheDocument();
    rerender(<AccountStatus {...props} coinBalance={500} error="Unavailable"/>);
    expect(screen.queryByLabelText(/Coin balance:/)).not.toBeInTheDocument();
  });
  it('animates actual coin changes without treating account changes as earnings', () => {
    const { rerender } = render(<AccountStatus {...props} coinBalance={10}/>);
    expect(screen.queryByText('+5')).not.toBeInTheDocument();
    rerender(<AccountStatus {...props} coinBalance={15}/>);
    expect(screen.getByText('+5')).toHaveAttribute('aria-hidden', 'true');
    rerender(<AccountStatus {...props} coinBalance={14}/>);
    expect(screen.getByText('−1')).toBeInTheDocument();
    rerender(<AccountStatus {...props} account={null} coinBalance={10}/>);
    expect(screen.queryByText('−1')).not.toBeInTheDocument();
  });
});
