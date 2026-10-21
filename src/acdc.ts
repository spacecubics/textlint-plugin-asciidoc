import { parseAsciiDoc as parseWasm } from "../wasm/pkg/acdc_parser.js";
import type { AcdcDocument, AcdcLocation } from "./acdc-types.js";

export interface AcdcParseResult {
  document: AcdcDocument;
  warnings: string[];
  warningKinds?: string[];
  warningLocations?: (AcdcLocation | null)[];
  sourceRecovery: boolean;
  attributeReferences?: [number, number][];
  sourceDirectives?: [number, number][];
}

export function parseAsciiDoc(source: string): AcdcParseResult {
  return JSON.parse(parseWasm(source)) as AcdcParseResult;
}
