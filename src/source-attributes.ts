import { type AcdcParseResult, parseAsciiDoc } from "./acdc.js";
import type { AcdcPosition } from "./acdc-types.js";

/** Parse source spelling instead of attribute-expanded prose. acdc 0.11 has
 * no public switch for disabling attribute substitutions throughout a document.
 * Private-use tokens keep scalar columns unchanged; synthetic link prefixes
 * have an explicit column map. Tokens are removed before returning the ASG.
 */
export function parseSource(source: string): AcdcParseResult {
  const tokens: { masked: string; original: string; link: boolean }[] = [];
  const insertions = new Map<number, number[]>();
  const references: [number, number][] = [];
  // Definitions and standalone block metadata configure parsing (e.g. cols).
  // They are not prose: let acdc resolve their attributes normally.
  const structuralRanges: [number, number][] = [];
  let continuation = false;
  for (const match of source.matchAll(/[^\r\n]+(?:\r\n|\n|\r|$)|\r\n|\n|\r/g)) {
    const line = match[0].replace(/[\r\n]+$/, "");
    const definition: boolean = continuation || /^:[a-zA-Z0-9_!-]+:/.test(line);
    if (definition || /^\[[^\r\n]*\][ \t]*$/.test(line))
      structuralRanges.push([match.index, match.index + match[0].length]);
    continuation = definition && /(?:\\| \+)[ \t]*$/.test(line);
  }
  let nextToken = 0xe000;
  const input = source.replace(
    /\{[a-zA-Z0-9_-]+\\?\}|\\[|!]/g,
    (original: string, offset: number) => {
      if (
        structuralRanges.some(([start, end]) => start <= offset && offset < end)
      )
        return original;
      while (
        nextToken <= 0xf8ff &&
        source.includes(String.fromCharCode(nextToken))
      )
        nextToken++;
      if (nextToken > 0xf8ff)
        throw new Error(
          "Too many attribute references for source-preserving parsing",
        );
      const masked = String.fromCharCode(nextToken++).repeat(original.length);
      // Table separator escapes are also removed before acdc computes inline
      // ranges. Protect them without treating them as attribute references.
      const escaped =
        original.startsWith("\\") ||
        source[offset - 1] === "\\" ||
        original.endsWith("\\}");
      // A bare attribute target needs link syntax even when expansion is disabled.
      const link =
        !escaped &&
        source[offset + original.length] === "[" &&
        (offset === 0 || /[\s(]/u.test(source[offset - 1]));
      if (link) {
        const before = source.slice(0, offset).split(/\r\n|\n|\r/);
        const line = before.length;
        const col = Array.from(before[before.length - 1]).length + 1;
        insertions.set(line, [...(insertions.get(line) ?? []), col]);
      }
      tokens.push({ masked, original, link });
      if (!escaped) references.push([offset, offset + original.length]);
      return `${link ? "link:" : ""}${masked}`;
    },
  );
  const result = parseAsciiDoc(input);
  const restoreString = (value: string) => {
    for (const token of tokens) {
      if (token.link)
        value = value.replaceAll(`link:${token.masked}`, token.original);
      value = value.replaceAll(token.masked, token.original);
    }
    return value;
  };
  const restorePosition = (point: AcdcPosition): AcdcPosition => {
    let added = 0;
    for (const col of insertions.get(point.line) ?? []) {
      if (point.col < col + added) break;
      if (point.col < col + added + 5) return { ...point, col };
      added += 5;
    }
    return { ...point, col: point.col - added };
  };
  function restore(value: unknown): unknown {
    if (typeof value === "string") return restoreString(value);
    if (Array.isArray(value)) return value.map(restore);
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      if (typeof object.line === "number" && typeof object.col === "number")
        return restorePosition(object as unknown as AcdcPosition);
      return Object.fromEntries(
        Object.entries(object).map(([key, item]) => [key, restore(item)]),
      );
    }
    return value;
  }
  return {
    ...(restore(result) as AcdcParseResult),
    attributeReferences: references,
  };
}
