import { createRequire } from "node:module";
import { test as assertAST } from "@textlint/ast-tester";
import { TextlintKernel } from "@textlint/kernel";
import type {
  TextlintFilterRuleReporter,
  TextlintRuleReporter,
} from "@textlint/types";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

const comments: TextlintFilterRuleReporter = createRequire(import.meta.url)(
  "textlint-filter-rule-comments",
);
const parse = (text: string) =>
  new plugin.Processor().processor().preProcess(text);
const typo: TextlintRuleReporter = (context) => ({
  Str(node) {
    for (const match of node.value.matchAll(/teh/g)) {
      context.report(
        node,
        new context.RuleError("Use the", {
          index: match.index,
          fix: context.fixer.replaceTextRange(
            [match.index, match.index + 3],
            "the",
          ),
        }),
      );
    }
  },
});
const options = {
  ext: ".adoc",
  plugins: [{ pluginId: "asciidoc", plugin }],
  rules: [{ ruleId: "typo", rule: { linter: typo, fixer: typo } }],
  filterRules: [{ ruleId: "comments", rule: comments }],
};

describe("comments", () => {
  it.each([
    "//",
    "// teh",
    "// 日本語 😀",
    "////\n////",
    "////\nteh\n*literal*\n////",
    "////\r\nteh\r\n////",
  ])("maps comment source %j", (text) => {
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children).toHaveLength(1);
    expect(ast.children[0]).toMatchObject({
      type: "Comment",
      raw: text,
      range: [0, text.length],
    });
  });
  it("does not lint comment text", async () => {
    const text = "// teh\n\n////\nteh\n////\n\nteh";
    const result = await new TextlintKernel().lintText(text, options);
    expect(result.messages.map((message) => message.line)).toEqual([7]);
  });
  it.each([
    ["// textlint-disable", "// textlint-enable"],
    ["// textlint-disable typo", "// textlint-enable typo"],
    ["////\ntextlint-disable typo\n////", "////\ntextlint-enable typo\n////"],
  ])("filters and fixes using %s", async (disable, enable) => {
    const text = `teh\n\n${disable}\n\nteh\n\n${enable}\n\nteh`;
    const kernel = new TextlintKernel();
    expect((await kernel.lintText(text, options)).messages).toHaveLength(2);
    expect((await kernel.fixText(text, options)).output).toBe(
      `the\n\n${disable}\n\nteh\n\n${enable}\n\nthe`,
    );
  });
  it("does not treat code contents as exclusion directives", async () => {
    const text = "----\n// textlint-disable\n----\n\nteh";
    expect(
      (await new TextlintKernel().lintText(text, options)).messages,
    ).toHaveLength(1);
  });
});
