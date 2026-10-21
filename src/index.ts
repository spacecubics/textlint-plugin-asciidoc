import type { TextlintPluginCreator } from "@textlint/types";
import { AsciiDocProcessor } from "./processor.js";

export default {
  Processor: AsciiDocProcessor,
} satisfies TextlintPluginCreator;
