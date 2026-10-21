/** Exclude balanced conditionals as source, without evaluating a build profile.
 * Keep verbatim blocks intact and leave malformed directives to the parser.
 */
export function conditionalLines(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  let pending: [number, number][] = [];
  let depth = 0;
  let verbatim: string | undefined;
  for (const match of source.matchAll(/[^\r\n]+/g)) {
    const line = match[0];
    const range: [number, number] = [match.index, match.index + line.length];
    if (!depth) {
      if (verbatim) {
        if (line === verbatim) verbatim = undefined;
        else if (/^(?:ifdef|ifndef|ifeval|endif)::/.test(line))
          ranges.push(range);
        continue;
      }
      if (/^(?:-{4,}|\.{4,}|\+{4,}|\/{4,}|`{3,})$/.test(line)) {
        verbatim = line;
        continue;
      }
    }
    const start = /^(ifdef|ifndef|ifeval)::[^[]*\[([^\r\n]*)\][ \t]*$/.exec(
      line,
    );
    if (start) {
      if (start[1] === "ifeval" || !start[2]) depth++;
      else if (!depth) {
        ranges.push(range);
        continue;
      }
    }
    if (depth) {
      pending.push(range);
      if (/^endif::[^[]*\[\][ \t]*$/.test(line) && --depth === 0) {
        ranges.push(...pending);
        pending = [];
      }
    }
  }
  return ranges;
}
