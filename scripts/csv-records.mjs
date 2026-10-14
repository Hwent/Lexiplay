export function csvRecords(text) {
  const rows = [], row = []; let field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(field); field = '';
      if (char !== ',') {
        if (row.some(value => value.length)) rows.push([...row]);
        row.length = 0;
        if (char === '\r' && text[i + 1] === '\n') i++;
      }
    } else field += char;
  }
  if (quoted) throw new Error('Unclosed quoted CSV field.');
  row.push(field); if (row.some(value => value.length)) rows.push(row);
  return rows;
}
