CREATE TABLE message (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES account_users(id) ON DELETE CASCADE,
  guest_session_id UUID REFERENCES guest_sessions(id) ON DELETE CASCADE,
  content VARCHAR(2000) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_sender_check CHECK ((user_id IS NOT NULL) <> (guest_session_id IS NOT NULL)),
  CONSTRAINT message_content_check CHECK (length(btrim(content)) BETWEEN 1 AND 2000)
);
CREATE INDEX message_user_id_idx ON message(user_id);
CREATE INDEX message_guest_session_id_idx ON message(guest_session_id);
CREATE INDEX message_created_at_idx ON message(created_at);
