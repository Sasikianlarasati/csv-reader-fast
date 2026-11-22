[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Sasikianlarasati/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Sasikianlarasati/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

# csv-reader-fast

A faster drop-in for make.fun's own **csv-reader 1.0.0**, written for the
make.fun bounty
["Read broken CSV files faster, 21 November 2026"](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
(`csv-reader-speed-01-run-20261121`, $100, 10 places paid $10 each).

`solve.js` exports `run(input)`, which returns exactly what csv-reader 1.0.0
returns for the same `{text, header}` input: `{columns, rows, errors}` —
same broken-row policy, same errors, same order. `main.ts` is the house
driver, unchanged: it reads every case from `/input/cases.json`, answers each
with `run`, and writes `/output/answers.json`.

## The reading policy (identical to csv-reader 1.0.0)

- A U+FEFF at the very start of the text is dropped.
- A record ends at LF or CRLF; a line left with no characters is no record.
- Outside quotes, a CR not followed by LF is dropped (`stray_cr`).
- A field that opens with a quote runs to the next quote that is not doubled
  (`""` inside it is one quote; each CRLF or lone CR inside it is read as
  LF); what follows its closing quote, up to the next comma or line break, is
  appended as it stands (`quote_junk`, when the field ends); a quote that
  never closes is a literal character, and the text after it is read again as
  unquoted (`unterminated_quote`).
- A quote inside an unquoted field is a literal character. Fields stay
  strings, never trimmed or converted.
- `columns` is the first record when `header` is true, else `null`; `rows`
  holds the records after it, each padded with `""` (`short_row`, with
  `fields`: its field count) or cut (`long_row`, with `extra`: the cut fields)
  to the first record's width.
- Each error is `{code, line, row}`, in the order met; `line` is the 1-based
  line its record starts on (counting every LF, CRLF and lone CR inside
  quotes), `row` its record's index in `rows` (`null` for the header).

## How it is faster

csv-reader 1.0.0 reads one character at a time, building each field with
`value += c`. This reader keeps the exact same policy but jumps instead of
stepping:

- **Unquoted fields:** two `indexOf` calls find the next comma and the next
  LF; the field is one `slice`. A CR inside the slice is the only slow case
  (split on `\r`, one `stray_cr` error each, join).
- **Quoted fields:** `indexOf('"')` jumps to the next quote; the segment
  between quotes is one `slice` (a regex replace only when it holds a line
  break, to turn each CRLF/lone CR into one LF and count lines).
- **No object per field:** the field readers return the value string and
  write how the field ended into a shared variable, so the hot loop builds
  no throwaway objects.
- Pure and dependency-free: no clock, no randomness, no locale, nothing kept
  from one call to the next; each case is answered alone.

## Measured performance

Measured locally on this machine (shared VM, Node v24) on the competition's
practice set — 6 cases, 10,194,353 characters, 63,692 rows:

| | parse only (CPU) | `main.ts` end-to-end (CPU, user+sys) |
|---|---|---|
| csv-reader 1.0.0 (house baseline) | ~850 ms | ~2.76 s |
| **csv-reader-fast (this repo)** | **~200 ms** | **~1.42 s** |
| speedup | **~4x** | **~1.9x** |

The end-to-end gap is narrower because `JSON.parse` of the cases and
`JSON.stringify` of the answers (~0.33 s combined) are the same for every
entry. Numbers are local measurements; the scoring box will differ, but the
relative gap is what the contest ranks.

## Verification

- **Practice set:** 6/6 cases identical to the oracle, scored with the kit's
  own scorer (`program/scorer/main.ts`).
- **Fresh sets:** 3 further sets drawn from the published generator
  (`program/generator/draw.ts`) with random seeds — 6/6 each, same scorer.
- **Correctness harness:** 286 checks, 0 failures — the 6 practice cases, 80
  hand-written edge cases (empty text, BOM only, lone CRs, CRLF mixes,
  unterminated quotes, quote junk, doubled quotes, short/long rows, header
  on/off, non-ASCII, emoji, missing trailing newline), and 200 fresh cases
  from the official generator.
- **Deterministic:** two runs write byte-for-byte identical `answers.json`.

## Run it

```sh
# from this repository's root, with the kit's practice input:
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=<out> node main.ts
```

Node 22 runs `node /bot/main.ts`; JavaScript source only, nothing installed.

## License

MIT. See `LICENSE`.
