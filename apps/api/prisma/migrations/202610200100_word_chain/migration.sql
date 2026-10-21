-- Refund unfinished ladders whose goal-based rules have been replaced.
WITH old_games AS (
  SELECT id, coin_user_id, coin_guest_session_id, (active_state->>'coinCost')::int AS refund
  FROM practice_games
  WHERE status='active' AND ladder_state IS NOT NULL AND NOT (ladder_state ? 'targetWords')
  FOR UPDATE
), cancelled AS (
  UPDATE practice_games g
  SET status='cancelled', finished_at=now(), active_state=NULL, collection_id=NULL,
      coin_change=coin_change+old.refund
  FROM old_games old WHERE g.id=old.id
  RETURNING old.coin_user_id, old.coin_guest_session_id, old.refund
), account_refunds AS (
  UPDATE account_users u SET coin_balance=coin_balance+r.refund
  FROM (SELECT coin_user_id, sum(refund)::int AS refund FROM cancelled
        WHERE coin_user_id IS NOT NULL GROUP BY coin_user_id) r
  WHERE u.id=r.coin_user_id
)
UPDATE guest_sessions s SET coin_balance=coin_balance+r.refund
FROM (SELECT coin_guest_session_id, sum(refund)::int AS refund FROM cancelled
      WHERE coin_guest_session_id IS NOT NULL GROUP BY coin_guest_session_id) r
WHERE s.id=r.coin_guest_session_id;
