import type { TextlintPluginCreator } from "@textlint/types";
import { AsciiDocProcessor } from "./processor.js";

export { type AcdcParseResult, parseAsciiDoc } from "./acdc.js";

export default {
  Processor: AsciiDocProcessor,
} satisfies TextlintPluginCreator;
