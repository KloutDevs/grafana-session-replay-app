const SESSION_ID = /^[A-Za-z0-9_-]{4,64}$/;
const MATCHER = String.raw`[a-zA-Z_][a-zA-Z0-9_]*\s*(?:=|!=|=~|!~)\s*"(?:[^"\\]|\\.)*"`;
const SELECTOR = new RegExp(String.raw`^\{\s*${MATCHER}(?:\s*,\s*${MATCHER})*\s*\}$`);

export function isValidSessionId(value: string): boolean {
  return SESSION_ID.test(value);
}

/** A LogQL stream selector with at least one matcher, such as `{service_name="frontend"}`. */
export function isValidSelector(value: string): boolean {
  return SELECTOR.test(value.trim());
}

export function escapeLogqlString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n').replaceAll('\r', '\\r');
}

/** A text literal for a line filter. Uses a raw string unless it has a backtick. */
export function literal(value: string): string {
  return value.includes('`') ? `"${escapeLogqlString(value)}"` : `\`${value}\``;
}

/** Line filter `|= literal`. */
export function contains(value: string): string {
  return `|= ${literal(value)}`;
}

/** Line filter `!= literal`. */
export function notContains(value: string): string {
  return `!= ${literal(value)}`;
}

/** Line filter with a regular expression, as a raw string. */
export function matches(regex: string): string {
  return `|~ ${literal(regex)}`;
}

/** Text that is inside every line holding an rrweb event of the given type (both formats). */
export function rrwebTypeText(type: number): string {
  return String.raw`\"type\":${type}`;
}
