import { jsonAdapter, logfmtAdapter, parseLogfmt, parseTimestamp } from '../logFormat';
import { escapeLogqlString, isValidSelector, isValidSessionId, literal, rrwebTypeText } from '../logql';

describe('logfmt', () => {
  it('reads plain and quoted values with escapes', () => {
    const fields = parseLogfmt('kind=log message="say \\"hi\\" \\\\ ok" level=warn');
    expect(fields).toEqual({ kind: 'log', message: 'say "hi" \\ ok', level: 'warn' });
  });

  it('keeps an rrweb event as one string', () => {
    const fields = parseLogfmt(
      'event_data_event="{\\"type\\":4,\\"data\\":{\\"href\\":\\"http://a/x y\\"}}" session_id=abc'
    );
    expect(JSON.parse(fields['event_data_event'] ?? '')).toEqual({ type: 4, data: { href: 'http://a/x y' } });
    expect(fields['session_id']).toBe('abc');
  });

  it('returns undefined for a line with no pairs', () => {
    expect(logfmtAdapter.parseLine('plain text')).toBeUndefined();
  });
});

describe('json', () => {
  it('turns every value into a string and skips nulls', () => {
    expect(jsonAdapter.parseLine('{"a":"x","n":3,"b":true,"z":null}')).toEqual({ a: 'x', n: '3', b: 'true' });
  });

  it('rejects text that is not a JSON object', () => {
    expect(jsonAdapter.parseLine('kind=log')).toBeUndefined();
    expect(jsonAdapter.parseLine('[1]')).toBeUndefined();
  });
});

describe('timestamps', () => {
  it('reads the Go time format and ISO', () => {
    expect(parseTimestamp('2026-11-22 02:14:02.291 +0000 UTC')).toBe(Date.parse('2026-11-22T02:14:02.291Z'));
    expect(parseTimestamp('2026-11-22T02:14:02.291Z')).toBe(Date.parse('2026-11-22T02:14:02.291Z'));
    expect(parseTimestamp('2026-11-22 02:14:02 -0300 UTC')).toBe(Date.parse('2026-11-22T05:14:02Z'));
  });

  it('gives undefined for unreadable values', () => {
    expect(parseTimestamp('soon')).toBeUndefined();
    expect(parseTimestamp(undefined)).toBeUndefined();
  });
});

describe('logql helpers', () => {
  it('accepts stream selectors and rejects anything else', () => {
    expect(isValidSelector('{service_name="frontend"}')).toBe(true);
    expect(isValidSelector('{source=~"faro|faro_replay", env!="x"}')).toBe(true);
    expect(isValidSelector('service_name="frontend"')).toBe(false);
    expect(isValidSelector('{}')).toBe(false);
    expect(isValidSelector('{a="b"} | json')).toBe(false);
  });

  it('accepts session ids of safe characters only', () => {
    expect(isValidSessionId('DhVSAXLEyx')).toBe(true);
    expect(isValidSessionId('a"} or {x="y')).toBe(false);
    expect(isValidSessionId('ab')).toBe(false);
  });

  it('escapes quoted strings and uses raw strings otherwise', () => {
    expect(escapeLogqlString('a"b\\c\n')).toBe('a\\"b\\\\c\\n');
    expect(literal('plain')).toBe('`plain`');
    expect(literal('has`tick')).toBe('"has`tick"');
  });

  it('matches the event type text that both formats contain', () => {
    expect(rrwebTypeText(4)).toBe('\\"type\\":4');
    const logfmt = 'event_data_event="{\\"type\\":4,\\"data\\":{}}"';
    const json = JSON.stringify({ event_data_event: '{"type":4,"data":{}}' });
    expect(logfmt.includes(rrwebTypeText(4))).toBe(true);
    expect(json.includes(rrwebTypeText(4))).toBe(true);
  });
});
