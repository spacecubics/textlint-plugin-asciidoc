import { createRequire } from "node:module";
import type { TxtNode, TxtParentNode } from "@textlint/ast-node-types";
import { test as assertAST } from "@textlint/ast-tester";
import { TextlintKernel } from "@textlint/kernel";
import type {
  TextlintFilterRuleReporter,
  TextlintRuleReporter,
} from "@textlint/types";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

const parse = (text: string) =>
  new plugin.Processor().processor().preProcess(text);
const reporter: TextlintRuleReporter = (context) => ({
  Str(node) {
    for (const match of node.value.matchAll(/誤字/g)) {
      context.report(
        node,
        new context.RuleError("Use 正字", {
          index: match.index,
          fix: context.fixer.replaceTextRange(
            [match.index, match.index + 2],
            "正字",
          ),
        }),
      );
    }
  },
});
const options = {
  ext: ".adoc",
  plugins: [{ pluginId: "asciidoc", plugin }],
  rules: [{ ruleId: "typo", rule: { linter: reporter, fixer: reporter } }],
};
const position = (text: string, offset: number) => {
  const lines = text.slice(0, offset).split(/\r\n|\n/);
  return { line: lines.length, column: lines[lines.length - 1].length };
};
function assertSource(text: string, node: TxtNode) {
  expect(node.raw).toBe(text.slice(...node.range));
  expect(node.loc).toEqual({
    start: position(text, node.range[0]),
    end: position(text, node.range[1]),
  });
  if ("children" in node) {
    let end = node.range[0];
    for (const child of (node as TxtParentNode).children) {
      expect(child.range[0]).toBeGreaterThanOrEqual(end);
      expect(child.range[1]).toBeLessThanOrEqual(node.range[1]);
      assertSource(text, child);
      end = child.range[1];
    }
  }
}

const samples = [
  "これは誤字です。",
  "😀誤字と𠮷野家の誤字。",
  "👩🏽‍💻誤字と🇯🇵誤字。",
  "か\u3099誤字とcafe\u0301誤字。",
  "葛\u{E0100}誤字と✈️誤字。",
  "😀日本語の**誤字**を確認する。",
  "😀日本語の__誤字__を確認する。",
  "日本語の *😀誤字* と _𠮷誤字_ 。",
  "😀 https://example.com[日本語の誤字]。",
  "https://example.com[👩🏽‍💻**誤字**]",
  "= 😀誤字\n\n== 𠮷誤字\n\n本文の誤字。",
  "* 😀誤字\n* 𠮷誤字\n** 👩🏽‍💻誤字",
  "|===\n|😀誤字 |か\u3099誤字\n|===",
  "____\n😀誤字\n____\n\nNOTE: 𠮷誤字",
  "😀誤字\n二行目の誤字。\n\n別段落の誤字。\n",
  "😀\\*誤字\\*を確認する。",
];

describe("Unicode source positions", () => {
  it.each(
    samples
      .flatMap((sample) => [sample, sample.replaceAll("\n", "\r\n")])
      .filter((sample, index, all) => all.indexOf(sample) === index),
  )("lints and fixes %j using UTF-16 offsets", async (text) => {
    const ast = parse(text);
    assertAST({ ...ast });
    assertSource(text, ast);
    const kernel = new TextlintKernel();
    const result = await kernel.lintText(text, options);
    expect(
      result.messages.map((message) => [message.line, message.column]),
    ).toEqual(
      [...text.matchAll(/誤字/g)].map((match) => {
        const loc = position(text, match.index);
        return [loc.line, loc.column + 1];
      }),
    );
    expect((await kernel.fixText(text, options)).output).toBe(
      text.replaceAll("誤字", "正字"),
    );
  });

  it.each(["\n", "\r\n"])(
    "preserves Unicode around exclusion comments with %j",
    async (eol) => {
      const comments: TextlintFilterRuleReporter = createRequire(
        import.meta.url,
      )("textlint-filter-rule-comments");
      const text = [
        "😀誤字",
        "// textlint-disable typo -- 日本語😀",
        "👩🏽‍💻誤字",
        "// textlint-enable typo -- 再開𠮷",
        "か\u3099誤字",
      ].join(eol);
      const ast = parse(text);
      assertAST({ ...ast });
      assertSource(text, ast);
      const kernel = new TextlintKernel();
      const filteredOptions = {
        ...options,
        filterRules: [{ ruleId: "comments", rule: comments }],
      };
      expect(
        (await kernel.lintText(text, filteredOptions)).messages.map(
          (message) => [message.line, message.column],
        ),
      ).toEqual([
        [1, 3],
        [5, 3],
      ]);
      expect((await kernel.fixText(text, filteredOptions)).output).toBe(
        [
          "😀正字",
          "// textlint-disable typo -- 日本語😀",
          "👩🏽‍💻誤字",
          "// textlint-enable typo -- 再開𠮷",
          "か\u3099正字",
        ].join(eol),
      );
    },
  );
});

describe("Unicode syntax and replacement boundaries", () => {
  it("recognizes unconstrained emphasis next to Japanese text", () => {
    expect(parse("😀日本語の**誤字**と__誤字__。").children[0]).toMatchObject({
      children: [
        { type: "Str", value: "😀日本語の" },
        {
          type: "Strong",
          range: [6, 12],
          children: [{ value: "誤字", range: [8, 10] }],
        },
        { type: "Str", value: "と" },
        { type: "Emphasis", children: [{ value: "誤字" }] },
        { type: "Str", value: "。" },
      ],
    });
    expect(
      parse("https://example.com[👩🏽‍💻**誤字**]").children[0],
    ).toMatchObject({
      children: [
        {
          type: "Link",
          children: [
            { type: "Str", value: "👩🏽‍💻" },
            { type: "Strong", children: [{ value: "誤字", range: [29, 31] }] },
          ],
        },
      ],
    });
  });
  it("replaces complete Unicode sequences without touching adjacent text", async () => {
    const replacement: TextlintRuleReporter = (context) => ({
      Str(node) {
        for (const match of node.value.matchAll(/𠮷|か\u3099|👩🏽‍💻/gu)) {
          context.report(
            node,
            new context.RuleError("Replace sequence", {
              index: match.index,
              fix: context.fixer.replaceTextRange(
                [match.index, match.index + match[0].length],
                "字",
              ),
            }),
          );
        }
      },
    });
    const text = "😀**𠮷**とhttps://example.com[か\u3099]と👩🏽‍💻。";
    const ast = parse(text);
    assertAST({ ...ast });
    assertSource(text, ast);
    const result = await new TextlintKernel().fixText(text, {
      ...options,
      rules: [
        {
          ruleId: "replace",
          rule: { linter: replacement, fixer: replacement },
        },
      ],
    });
    expect(result.output).toBe("😀**字**とhttps://example.com[字]と字。");
  });
});
