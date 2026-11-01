/**
 * Cards out of a spreadsheet: CSV, TSV, or Anki's "Notes in Plain Text".
 *
 * One row is one card — the first column is the question, the second the
 * answer, and every column after that fills the deck template's text fields
 * in order (and lands on the back after them, when there are more columns
 * than fields). That is the whole mapping; there is no screen to set it up,
 * because a file that needs one is a file better fixed in the spreadsheet.
 *
 * What it understands, beyond plain rows:
 *
 * - the separator, guessed from the first row — tab, semicolon, comma or `|`,
 *   whichever it holds most of outside quotes (Excel in Polish writes
 *   semicolons, Google Sheets commas, Anki tabs);
 * - quotes the way RFC 4180 has them: `"a, b"`, `""` for a quote, a line
 *   break inside quotes staying part of the cell;
 * - Anki's header lines: `#separator:`, `#html:true` (tags stripped, `<br>`
 *   kept as a line break), `#tags column:N`, and the `#notetype`, `#deck` and
 *   `#guid` columns, which are dropped rather than read as fields. Any other
 *   line starting with `#` is a comment;
 * - a UTF-8 byte order mark, which Excel puts in front of „CSV UTF-8".
 *
 * Text only, and UTF-8 only: a column cannot carry a file, and guessing a
 * code page is how „żółw" turns into „ĹĽĂłĹ‚w".
 */

export type CsvCard = { front: string; back: string; extra: string[]; tags: string[] };

const SEPARATOR_NAMES: Record<string, string> = {
  tab: '\t',
  comma: ',',
  semicolon: ';',
  pipe: '|',
  space: ' ',
  colon: ':',
};

const CANDIDATES = ['\t', ';', ',', '|'];

type Header = {
  separator: string | null;
  html: boolean;
  /** 0-based columns that are not fields. */
  tagsColumn: number | null;
  dropped: Set<number>;
};

/** `#key:value` → the header it adds to. Unknown keys are comments. */
function readHeaderLine(line: string, header: Header): void {
  const match = /^#([a-z ]+):(.*)$/i.exec(line.trim());
  if (!match) return;

  const key = match[1].trim().toLowerCase();
  const value = match[2].trim();
  const column = Number.parseInt(value, 10) - 1;

  if (key === 'separator') {
    header.separator = SEPARATOR_NAMES[value.toLowerCase()] ?? (value.length === 1 ? value : header.separator);
  } else if (key === 'html') {
    header.html = value.toLowerCase() === 'true';
  } else if (key === 'tags column' && column >= 0) {
    header.tagsColumn = column;
  } else if ((key === 'notetype column' || key === 'deck column' || key === 'guid column') && column >= 0) {
    header.dropped.add(column);
  }
}

/** How many times `separator` appears in a line outside quotes. */
function countOutsideQuotes(line: string, separator: string): number {
  let quoted = false;
  let count = 0;

  for (const character of line) {
    if (character === '"') quoted = !quoted;
    else if (!quoted && character === separator) count += 1;
  }

  return count;
}

/** The separator the first row uses most; none at all means one column per row. */
export function guessSeparator(line: string): string {
  let best = '\t';
  let most = 0;

  for (const candidate of CANDIDATES) {
    const count = countOutsideQuotes(line, candidate);
    if (count > most) {
      best = candidate;
      most = count;
    }
  }

  return best;
}

/**
 * Splits text into rows of cells, RFC 4180 style. `isComment` sees each line
 * that starts outside quotes, before it is split, and can claim it.
 */
function rows(text: string, separator: () => string, isComment: (line: string) => boolean): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let lineStart = true;
  let i = 0;

  const endRow = () => {
    row.push(cell);
    out.push(row);
    row = [];
    cell = '';
    lineStart = true;
  };

  while (i < text.length) {
    if (lineStart) {
      const end = text.indexOf('\n', i);
      const line = text.slice(i, end === -1 ? text.length : end).replace(/\r$/, '');

      if (isComment(line)) {
        i = end === -1 ? text.length : end + 1;
        continue;
      }

      lineStart = false;
    }

    const character = text[i];

    if (quoted) {
      if (character === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 2;
        continue;
      }

      if (character === '"') quoted = false;
      else cell += character;

      i += 1;
      continue;
    }

    if (character === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (character === separator()) {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      endRow();
    } else if (character !== '\r') {
      cell += character;
    }

    i += 1;
  }

  if (cell !== '' || row.length > 0) endRow();

  return out;
}

const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

/** Anki's HTML down to the text a card here holds: line breaks kept, everything else gone. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Every card the text describes, in file order. Rows with no question are left out. */
export function parseCsv(input: string): CsvCard[] {
  const text = input.replace(/^﻿/, '');
  const header: Header = { separator: null, html: false, tagsColumn: null, dropped: new Set() };

  let separator: string | null = null;

  const table = rows(
    text,
    () => separator ?? '\t',
    (line) => {
      if (line.startsWith('#')) {
        readHeaderLine(line, header);
        return true;
      }

      if (line.trim() === '') return true;

      // The first real line settles the separator, unless a header named it.
      separator ??= header.separator ?? guessSeparator(line);
      return false;
    }
  );

  const clean = (cell: string) => (header.html ? htmlToText(cell) : cell.trim());

  return table.flatMap((cells): CsvCard[] => {
    const fields: string[] = [];
    let tags: string[] = [];

    cells.forEach((cell, column) => {
      if (column === header.tagsColumn) tags = cell.split(/\s+/).filter(Boolean);
      else if (!header.dropped.has(column)) fields.push(clean(cell));
    });

    const [front = '', back = '', ...extra] = fields;

    if (!front) return [];

    // Trailing empty cells are what a spreadsheet pads short rows with.
    while (extra.length > 0 && extra[extra.length - 1] === '') extra.pop();

    return [{ front, back, extra, tags }];
  });
}
