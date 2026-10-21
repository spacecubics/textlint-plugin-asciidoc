import type { TxtNode, TxtParentNode } from "@textlint/ast-node-types";
import { test as assertAST } from "@textlint/ast-tester";
import { TextlintKernel } from "@textlint/kernel";
import type { TextlintRuleReporter } from "@textlint/types";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

const parse = (text: string) =>
  new plugin.Processor().processor().preProcess(text);
const reporter: TextlintRuleReporter = (context) => ({
  Str(node) {
    for (const match of node.value.matchAll(/teh/g))
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
  },
});
const options = {
  ext: ".adoc",
  plugins: [{ pluginId: "asciidoc", plugin }],
  rules: [{ ruleId: "typo", rule: { linter: reporter, fixer: reporter } }],
};
function checkRanges(text: string, node: TxtNode) {
  expect(node.raw).toBe(text.slice(...node.range));
  if ("children" in node) {
    let cursor = node.range[0];
    for (const child of (node as TxtParentNode).children) {
      expect(child.range[0]).toBeGreaterThanOrEqual(cursor);
      expect(child.range[1]).toBeLessThanOrEqual(node.range[1]);
      checkRanges(text, child);
      cursor = child.range[1];
    }
  }
}

describe("table cells", () => {
  it.each([
    "|===\n| |teh\n|teh |\n|===",
    "|===\n| |\n|===",
    '[cols="1,1"]\n|===\n2+|😀teh\n|teh |teh\n|===',
    '[cols="1,1"]\n|===\n.2+|😀teh |teh\n|teh\n|===',
    '[cols="1,1"]\n|===\n2.2+|😀teh\n|===',
    '[cols="1,1",options="header,footer"]\n|===\n| |teh\n|teh |\n| |teh\n|===',
    '[cols="1,1"]\n|===\n^s|teh .>e|teh\n|===',
    "|===\n|😀**teh** https://example.com[teh] {product}\n|===",
    "|===\n|😀teh\nnext teh\n|===",
    "|===\n|😀A \\| teh\n|===",
  ])("maps cell source in %j", async (sample) => {
    for (const eol of ["\n", "\r\n"]) {
      const text = sample.replaceAll("\n", eol);
      const ast = parse(text);
      assertAST({ ...ast });
      checkRanges(text, ast);
      expect(ast.children[0].type).toBe("Table");
      const kernel = new TextlintKernel();
      expect(
        (await kernel.lintText(text, options)).messages.map((message) => [
          message.line,
          message.column,
        ]),
      ).toEqual(
        [...text.matchAll(/teh/g)].map((match) => {
          const lines = text.slice(0, match.index).split(eol);
          return [lines.length, lines[lines.length - 1].length + 1];
        }),
      );
      expect((await kernel.fixText(text, options)).output).toBe(
        text.replaceAll("teh", "the"),
      );
    }
  });
  it("excludes literal and monospace cells but lints headings and emphasis", async () => {
    const text = '[cols="l,m,h,s,e"]\n|===\n|teh |teh |teh |teh |teh\n|===';
    const ast = parse(text);
    assertAST({ ...ast });
    checkRanges(text, ast);
    expect(ast.children[0]).toMatchObject({
      children: [
        {
          children: [
            { children: [{ type: "Code" }] },
            { children: [{ type: "Code" }] },
            { children: [{ type: "Str" }] },
            { children: [{ type: "Strong" }] },
            { children: [{ type: "Emphasis" }] },
          ],
        },
      ],
    });
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text.replace("|teh |teh |teh |teh |teh", "|teh |teh |the |the |the"),
    );
  });
  it("excludes duplicated cells without inventing repeated source positions", () => {
    expect(parse('[cols="1,1"]\n|===\n2*|teh\n|===').children).toMatchObject([
      { type: "CodeBlock" },
    ]);
  });
});

describe("block content in tables", () => {
  it.each([
    "|===\n|First teh\n\nSecond teh\n|===",
    '[cols="1,1"]\n|===\na|😀teh\n\n* teh\n* **teh**\n\n----\ncode\n----\n|teh\n|===',
    '[cols="1,1"]\n|===\na|== teh\n\nNOTE: teh\n\nh|teh\n|===',
    '[cols="1,1"]\n|===\na|First teh\n\nSecond teh\ns|teh\n|===',
  ])("preserves blocks in %j", async (sample) => {
    for (const eol of ["\n", "\r\n"]) {
      const text = sample.replaceAll("\n", eol);
      const ast = parse(text);
      assertAST({ ...ast });
      checkRanges(text, ast);
      expect(ast.children.some((node) => node.type === "Table")).toBe(false);
      expect((await new TextlintKernel().fixText(text, options)).output).toBe(
        text.replaceAll("teh", "the"),
      );
    }
  });
  it("preserves paragraph boundaries and code blocks", async () => {
    const text = "|===\na|First teh\n\nSecond teh\n\n----\nteh\n----\n|===";
    const ast = parse(text);
    expect(ast.children.map((node) => node.type)).toEqual([
      "Paragraph",
      "Paragraph",
      "CodeBlock",
    ]);
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text
        .replace("First teh", "First the")
        .replace("Second teh", "Second the"),
    );
  });
});

it("keeps nested table and code structures inside AsciiDoc cells", async () => {
  const text =
    '[cols="1,1"]\n|===\na|\n!===\n!😀teh\n!===\nl|teh\n\nmore teh\n|===';
  const ast = parse(text);
  assertAST({ ...ast });
  checkRanges(text, ast);
  expect(ast.children.map((node) => node.type)).toEqual(["Table", "CodeBlock"]);
  expect((await new TextlintKernel().fixText(text, options)).output).toBe(
    text.replace("😀teh", "😀the"),
  );
});

it("resolves structural attributes without expanding cell prose", async () => {
  const text =
    ':first: 1\n:columns: {first},1\n:product: teh product\n\n[cols="{columns}"]\n|===\n2+|{product} teh\n| |teh\n|===';
  const ast = parse(text);
  assertAST({ ...ast });
  checkRanges(text, ast);
  expect(ast.children[0]).toMatchObject({
    type: "Table",
    children: [
      {
        children: [
          {
            children: [{ type: "Code", value: "{product}" }, { value: " teh" }],
          },
        ],
      },
      { children: [{ children: [] }, { children: [{ value: "teh" }] }] },
    ],
  });
  expect((await new TextlintKernel().fixText(text, options)).output).toBe(
    text.replace("{product} teh", "{product} the").replace("| |teh", "| |the"),
  );
});
