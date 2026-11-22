// csv-reader-fast: a faster drop-in for make.fun's own csv-reader 1.0.0.
//
// run(input) returns exactly what csv-reader 1.0.0's readCsv returns for the
// same input {text, header}: {columns, rows, errors}. The same reading policy,
// implemented with indexOf/slice jumps instead of one character at a time:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled ("" inside it one quote, each CRLF or lone CR inside it read as
//     LF); what follows its closing quote, up to the next comma or line break,
//     is appended as it stands (quote_junk, when the field ends); a quote that
//     never closes is a literal character, and the text after it is read again
//     as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it, each padded with "" (short_row, with fields: its
//     count) or cut (long_row, with extra: the cut fields) to the first
//     record's width;
//   - each error is {code, line, row}, in the order met: line the 1-based
//     line its record starts on, counting every LF, CRLF and lone CR inside
//     quotes, and row its record's index in rows, null for the header.
//
// Pure: no clock, no randomness, no locale, nothing kept from one call to
// the next. Dependency-free ES module. Written from the reference's policy
// (kit baselines/csv-reader/vendor/csv-reader/index.js), not from its code.

/** How a field ended: at a comma, at a line break, or at the end of the text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended (COMMA, LINE_BREAK or END): the field
  // readers write it and return only the field's value, so no object is
  // built per field.
  let ended = END;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field starting at pos: the field runs to the next
  // comma or line break, or to the end of the text. A CR not followed by LF
  // is dropped (stray_cr); a CR that ends the field with the LF after it is
  // the CRLF line break. Returns the field's value and sets `ended`.
  function readUnquoted() {
    const start = pos;
    const comma = text.indexOf(',', start);
    const lf = text.indexOf('\n', start);
    const end = comma === -1 ? lf : lf === -1 ? comma : comma < lf ? comma : lf;
    if (end === -1) {
      // The field runs to the end of the text; any CR in it is a stray one.
      const seg = text.slice(start);
      pos = n;
      ended = END;
      if (seg.indexOf('\r') === -1) return seg;
      const parts = seg.split('\r');
      for (let i = 1; i < parts.length; i++) error('stray_cr');
      return parts.join('');
    }
    let segEnd = end;
    if (text.charCodeAt(end) === 10) {
      line += 1;
      ended = LINE_BREAK;
      if (end > start && text.charCodeAt(end - 1) === 13) segEnd = end - 1;
    } else {
      ended = COMMA;
    }
    const seg = text.slice(start, segEnd);
    pos = end + 1;
    if (seg.indexOf('\r') === -1) return seg;
    const parts = seg.split('\r');
    for (let i = 1; i < parts.length; i++) error('stray_cr');
    return parts.join('');
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field's
  // value and sets `ended`.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return '"' + readUnquoted();
      }
      const seg = text.slice(p, q);
      if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
        value += seg;
      } else {
        // Each CRLF or lone CR inside quotes is read as one LF.
        value += seg.replace(/\r\n?|\n/g, () => {
          line += 1;
          return '\n';
        });
      }
      if (text.charCodeAt(q + 1) === 34) {
        value += '"';
        p = q + 2;
        continue;
      }
      pos = q + 1;
      break;
    }
    if (pos >= n) {
      ended = END;
      return value;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      ended = COMMA;
      return value;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      ended = LINE_BREAK;
      return value;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted();
    if (junk.length > 0) error('quote_junk');
    return value + junk;
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      fields.push(quoted ? readQuoted() : readUnquoted());
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
