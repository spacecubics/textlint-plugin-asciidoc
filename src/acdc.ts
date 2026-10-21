import { parseAsciiDoc as parseWasm } from "../wasm/pkg/acdc_parser.js";
import type { AcdcDocument } from "./acdc-types.js";

export interface AcdcParseResult {
  document: AcdcDocument;
  warnings: string[];
  sourceRecovery: boolean;
}

export function parseAsciiDoc(source: string): AcdcParseResult {
  return JSON.parse(parseWasm(source)) as AcdcParseResult;
}
