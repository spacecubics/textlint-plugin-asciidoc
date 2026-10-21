import { parseAsciiDoc as parseWasm } from "../wasm/pkg/acdc_parser.js";

export interface AcdcParseResult {
  // The upstream ASG will be typed when implementing the TxtAST adapter.
  document: unknown;
  warnings: string[];
  sourceRecovery: boolean;
}

export function parseAsciiDoc(source: string): AcdcParseResult {
  return JSON.parse(parseWasm(source)) as AcdcParseResult;
}
