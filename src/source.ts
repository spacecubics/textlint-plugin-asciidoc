import type { TxtNode, TxtNodePosition } from "@textlint/ast-node-types";
import type { AcdcLocation, AcdcPosition } from "./acdc-types.js";

export class Source {
  private readonly lines: { start: number; text: string }[] = [];
  constructor(readonly text: string) {
    let start = 0;
    for (const match of text.matchAll(/\r\n|\r|\n/g)) {
      this.lines.push({ start, text: text.slice(start, match.index) });
      start = match.index + match[0].length;
    }
    this.lines.push({ start, text: text.slice(start) });
  }
  lineStart(line: number) {
    const row = this.lines[line - 1];
    if (!row) throw new Error(`Invalid source line: ${line}`);
    return row.start;
  }
  lineEnd(line: number) {
    return this.lineStart(line) + this.lines[line - 1].text.length;
  }
  offset(point: AcdcPosition, end = false): number {
    const line = this.lines[point.line - 1];
    const chars = line && Array.from(line.text);
    const next = this.lines[point.line];
    if (
      point.file ||
      !chars ||
      !Number.isInteger(point.col) ||
      point.col < 1 ||
      point.col > chars.length + (next ? 1 : 0)
    ) {
      throw new Error(`Invalid acdc source position: ${JSON.stringify(point)}`);
    }
    // acdc represents a newline at the column after the last scalar. CRLF
    // is one parser newline but occupies two UTF-16 code units in the source.
    if (point.col === chars.length + 1)
      return end ? next.start : line.start + line.text.length;
    return (
      line.start + chars.slice(0, point.col - (end ? 0 : 1)).join("").length
    );
  }
  position(offset: number): TxtNodePosition {
    let low = 0;
    let high = this.lines.length;
    while (low + 1 < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.lines[mid].start <= offset) low = mid;
      else high = mid;
    }
    return { line: low + 1, column: offset - this.lines[low].start };
  }
  span(start: number, end: number): Pick<TxtNode, "raw" | "range" | "loc"> {
    if (start < 0 || end < start || end > this.text.length) {
      throw new Error(`Invalid source range: ${start}..${end}`);
    }
    return {
      raw: this.text.slice(start, end),
      range: [start, end],
      loc: { start: this.position(start), end: this.position(end) },
    };
  }
  location(location: AcdcLocation) {
    return this.span(this.offset(location[0]), this.offset(location[1], true));
  }
}
