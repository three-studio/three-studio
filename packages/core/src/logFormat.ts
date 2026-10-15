/*
 * How a console call's arguments become the text of one line: in the editor's
 * Console, and on a device, whose lines reach that same Console. One writer
 * for both, or the same `console.log` would read one way in Play and another
 * from a phone.
 *
 * Not `JSON.stringify`, which the editor's Console used to hand everything
 * to. It calls `toJSON`, and three's `Object3D.toJSON` takes the key that
 * `JSON.stringify` passes it on a root call as the sign to serialize the whole
 * subtree — every geometry, every material, and every texture's image drawn
 * into a PNG data URL. A script's `this.log('here', this.transform)` paid that
 * on every call, and a phone would then have posted the result. So this never
 * calls `toJSON`, reads only a value's own fields, and stops at a fixed size
 * however much there is to read.
 *
 * Plain data — objects of no class, arrays, strings, finite numbers, booleans,
 * `null` — reads exactly as `JSON.stringify` writes it, as the Console always
 * read. What JSON has no word for is written out rather than lost: `undefined`,
 * `NaN`, an object's class, a cycle.
 *
 * It imports nothing, so that the device client takes this one file and not
 * the barrel, which would bring the scene model with it.
 */

/** Levels opened: an object in an object in an object. Deeper ones read `{…}`. */
const DEPTH = 3;
/** Fields or items written at each level, before `…`. */
const ITEMS = 20;
/** Characters written for one argument, the last one `…` when it is cut. */
const LENGTH = 1_000;

const CUT = '…';
const UNPRINTABLE = '[unprintable]';
const CIRCULAR = '[Circular]';

/**
 * A console call's arguments, each written as the Console shows it, joined
 * by a space.
 *
 * A string argument is kept whole, as is an error's message: what was said on
 * purpose is the caller's to bound. Anything else is cut at `LENGTH`
 * characters. Never throws.
 */
export function formatLogArgs(args: readonly unknown[]): string {
  return args.map(formatArg).join(' ');
}

function formatArg(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;
  } catch {
    // A proxy, or an error whose name throws: a log call must never be what
    // throws.
    return UNPRINTABLE;
  }
  const line = new Line();
  line.value(value, 1);
  return line.text();
}

/** What an object is written as, read before a character of it is written. */
type Shape =
  | { kind: 'word'; text: string }
  | { kind: 'array'; count: number }
  | { kind: 'object'; name: string; keys: readonly string[] | null };

/** One argument's text, written piece by piece until it is full. */
class Line {
  private readonly parts: string[] = [];
  private length = 0;
  private full = false;
  /** The objects being written, outermost first: one met again among them is a cycle. */
  private readonly path: object[] = [];

  text(): string {
    const written = this.parts.join('');
    return this.full ? `${written.slice(0, LENGTH - 1)}${CUT}` : written;
  }

  value(value: unknown, level: number): void {
    if (this.full) return;
    if (typeof value === 'object' && value !== null) {
      this.object(value, level);
      return;
    }
    let text: string;
    try {
      text = scalarText(value);
    } catch {
      text = UNPRINTABLE;
    }
    this.write(text);
  }

  private object(value: object, level: number): void {
    if (this.path.includes(value)) {
      this.write(CIRCULAR);
      return;
    }
    const shape = shapeOf(value, level <= DEPTH);
    if (shape === null) {
      this.write(UNPRINTABLE);
      return;
    }
    if (shape.kind === 'word') {
      this.write(shape.text);
      return;
    }

    const array = shape.kind === 'array';
    const [open, close] = array ? ['[', ']'] : ['{', '}'];
    if (!array && shape.name !== '') this.write(`${shape.name} `);
    if (level > DEPTH) {
      this.write(`${open}${CUT}${close}`);
      return;
    }

    const keys = array ? [] : (shape.keys ?? []);
    const count = array ? shape.count : keys.length;
    this.path.push(value);
    this.write(open);
    for (let index = 0; index < count && !this.full; index += 1) {
      if (index > 0) this.write(',');
      if (index === ITEMS) {
        this.write(CUT);
        break;
      }
      const key = array ? index : keys[index]!;
      if (!array) this.write(`${JSON.stringify(key)}:`);
      let field: unknown;
      try {
        field = (value as Record<string | number, unknown>)[key];
      } catch {
        this.write(UNPRINTABLE);
        continue;
      }
      this.value(field, level + 1);
    }
    this.write(close);
    this.path.pop();
  }

  private write(text: string): void {
    if (this.full) return;
    const room = LENGTH - this.length;
    if (text.length > room) {
      // Kept to the brim, so that `text()` has its `LENGTH - 1` characters to
      // keep before the cut.
      this.parts.push(text.slice(0, room));
      this.length = LENGTH;
      this.full = true;
      return;
    }
    this.parts.push(text);
    this.length += text.length;
  }
}

function scalarText(value: unknown): string {
  switch (typeof value) {
    case 'string':
      // Cut before quoting: a megabyte string would otherwise be escaped whole
      // to keep its first thousand characters.
      return JSON.stringify(cutText(value));
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `ƒ ${value.name || 'anonymous'}`;
    default:
      // A number, a boolean, `undefined` or `null`: `NaN` and `Infinity`
      // included, where JSON would have written `null`.
      return String(value);
  }
}

/**
 * How an object is written. `opened` says whether its fields will be: a level
 * past `DEPTH` reads none of them. `null` when it cannot be looked into: a
 * proxy, or an object whose prototype lies.
 */
function shapeOf(value: object, opened: boolean): Shape | null {
  try {
    return readShape(value, opened);
  } catch {
    return null;
  }
}

function readShape(value: object, opened: boolean): Shape {
  // Written as one word at any depth: their fields say nothing, or would say
  // thousands of numbers.
  if (value instanceof Error) {
    return { kind: 'word', text: JSON.stringify(cutText(`${value.name}: ${value.message}`)) };
  }
  if (value instanceof Date) {
    // What `JSON.stringify` writes through `Date`'s own `toJSON`, without
    // calling a method the value could have replaced.
    const time = Date.prototype.getTime.call(value);
    const text = Number.isNaN(time) ? 'null' : JSON.stringify(new Date(time).toISOString());
    return { kind: 'word', text };
  }
  if (ArrayBuffer.isView(value)) {
    const size = 'length' in value ? Number(value.length) : value.byteLength;
    return { kind: 'word', text: `${classNameOf(value) || 'ArrayBufferView'}(${size})` };
  }
  if (value instanceof ArrayBuffer) {
    return { kind: 'word', text: `ArrayBuffer(${value.byteLength})` };
  }
  if (value instanceof Map || value instanceof Set) {
    const name = classNameOf(value) || (value instanceof Map ? 'Map' : 'Set');
    return { kind: 'word', text: `${name}(${value.size})` };
  }
  if (Array.isArray(value)) return { kind: 'array', count: opened ? value.length : 0 };
  return { kind: 'object', name: classNameOf(value), keys: opened ? Object.keys(value) : null };
}

/** Its class's name, or `''` for plain data — an object of no class — and a class with no name. */
function classNameOf(value: object): string {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) return '';
  try {
    const name: unknown = (prototype as { constructor?: { name?: unknown } }).constructor?.name;
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

function cutText(text: string): string {
  return text.length > LENGTH ? text.slice(0, LENGTH) : text;
}
