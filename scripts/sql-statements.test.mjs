import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlStatements } from './sql-statements.mjs';
test('migration splitter preserves DO blocks, comments and escaped quotes', () => {
  const statements = sqlStatements("-- semicolon ;\nBEGIN; DO $$ BEGIN INSERT INTO t VALUES ('it''s;safe'); END $$; /* nested /* ; */ ; */ SELECT \"a;b\"; COMMIT;");
  assert.equal(statements.length,4);
  assert.match(statements[1], /END \$\$$/);
  assert.match(statements[2], /SELECT "a;b"$/);
  assert.throws(() => sqlStatements("DO $body$ BEGIN;"), /Unterminated/);
});
