// Split repository migrations without splitting quoted text, comments or DO $$ blocks.
export function sqlStatements(sql) {
  const result = [];
  let start = 0, quote = '', dollar = '', lineComment = false, blockDepth = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockDepth) { if (c === '/' && next === '*') { blockDepth++; i++; } else if (c === '*' && next === '/') { blockDepth--; i++; } continue; }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ''; } continue; }
    if (quote) { if (c === quote) { if (next === quote) i++; else quote = ''; } continue; }
    if (c === '-' && next === '-') { lineComment = true; i++; continue; }
    if (c === '/' && next === '*') { blockDepth = 1; i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '$') { const match = sql.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/); if (match) { dollar = match[0]; i += dollar.length - 1; continue; } }
    if (c === ';') { result.push(sql.slice(start, i).trim()); start = i + 1; }
  }
  if (quote || dollar || blockDepth) throw new Error('Unterminated migration SQL.');
  if (sql.slice(start).trim()) result.push(sql.slice(start).trim());
  return result.filter(statement => statement.replace(/--[^\n]*(?:\n|$)/g, '').trim());
}
