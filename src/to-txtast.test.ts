import { test as assertAST } from "@textlint/ast-tester";
import { TextlintKernel } from "@textlint/kernel";
import type { TextlintRuleReporter } from "@textlint/types";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

const parse = (text: string) =>
  new plugin.Processor().processor().preProcess(text);
const reporter: TextlintRuleReporter = (context) => ({
  Str(node) {
    const index = node.value.indexOf("teh");
    if (index < 0) return;
    context.report(
      node,
      new context.RuleError("Use the", {
        index,
        fix: context.fixer.replaceTextRange([index, index + 3], "the"),
      }),
    );
  },
});
const options = {
  ext: ".adoc",
  plugins: [{ pluginId: "asciidoc", plugin }],
  rules: [{ ruleId: "typo", rule: { linter: reporter, fixer: reporter } }],
};

describe("plain text", () => {
  it("represents an empty document", () => {
    expect(parse("")).toEqual({
      type: "Document",
      raw: "",
      range: [0, 0],
      children: [],
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
    });
  });
  it("maps a paragraph and its original range", () => {
    const ast = parse("Hello world.");
    assertAST({ ...ast });
    expect(ast.children).toEqual([
      {
        type: "Paragraph",
        raw: "Hello world.",
        range: [0, 12],
        loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 12 } },
        children: [
          {
            type: "Str",
            value: "Hello world.",
            raw: "Hello world.",
            range: [0, 12],
            loc: {
              start: { line: 1, column: 0 },
              end: { line: 1, column: 12 },
            },
          },
        ],
      },
    ]);
  });
  it("reports and fixes the source through textlint", async () => {
    const kernel = new TextlintKernel();
    const result = await kernel.lintText("Read teh manual.", options);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({ line: 1, column: 6, index: 5 });
    expect((await kernel.fixText("Read teh manual.", options)).output).toBe(
      "Read the manual.",
    );
  });
  it("rejects unsupported syntax and parser recovery", () => {
    expect(() => parse("A #marked# word.")).toThrow(/Unsupported/);
    expect(() => parse("----\nUnclosed")).toThrow(/diagnostics/);
  });
});

describe("paragraph boundaries", () => {
  it.each(["\n", "\r\n"])(
    "preserves %j line endings and fixes the second line",
    async (eol) => {
      const text = `First.  ${eol}Read teh manual.${eol}${eol}Last.${eol}`;
      const ast = parse(text);
      assertAST({ ...ast });
      expect(ast.children.map((node) => node.raw)).toEqual([
        `First.  ${eol}Read teh manual.`,
        "Last.",
      ]);
      expect(ast.range).toEqual([0, text.length]);
      expect(ast.loc.end).toEqual({ line: 5, column: 0 });
      expect(ast.children[1].loc.start).toEqual({ line: 4, column: 0 });
      const kernel = new TextlintKernel();
      const lint = await kernel.lintText(text, options);
      expect(lint.messages[0]).toMatchObject({ line: 2, column: 6 });
      expect((await kernel.fixText(text, options)).output).toBe(
        text.replace("teh", "the"),
      );
    },
  );
  it("preserves blank input without inventing paragraphs", () => {
    const ast = parse("\n\n");
    expect(ast.children).toEqual([]);
    expect(ast.range).toEqual([0, 2]);
    expect(ast.loc.end).toEqual({ line: 3, column: 0 });
  });
});

it("maps an explicit line break without moving following text", async () => {
  const text = "First. +\nRead teh manual.";
  expect(parse(text).children[0]).toMatchObject({
    children: [
      { type: "Str", value: "First." },
      { type: "Break", raw: " +", range: [6, 8] },
      {
        type: "Str",
        value: "Read teh manual.",
        loc: { start: { line: 2, column: 0 } },
      },
    ],
  });
  expect((await new TextlintKernel().fixText(text, options)).output).toBe(
    "First. +\nRead the manual.",
  );
});

describe("inline emphasis", () => {
  it.each(["*teh*", "**teh**", "_teh_", "__teh__", "*a _teh_ word*"])(
    "preserves markup while fixing %s",
    async (markup) => {
      const text = `Read ${markup} manual.`;
      const ast = parse(text);
      assertAST({ ...ast });
      expect((await new TextlintKernel().fixText(text, options)).output).toBe(
        text.replace("teh", "the"),
      );
    },
  );
  it("keeps nested emphasis and positions", () => {
    const ast = parse("A *bold _word_*.");
    expect(ast.children[0]).toMatchObject({
      children: [
        { type: "Str", value: "A " },
        {
          type: "Strong",
          raw: "*bold _word_*",
          range: [2, 15],
          children: [
            { type: "Str", value: "bold " },
            {
              type: "Emphasis",
              raw: "_word_",
              children: [{ type: "Str", value: "word", range: [9, 13] }],
            },
          ],
        },
        { type: "Str", value: "." },
      ],
    });
  });
});

describe("headings", () => {
  it("flattens sections while keeping heading depth and title ranges", async () => {
    const text =
      "= Manual\n\n== Read *teh* guide\n\nText.\n\n=== Details\n\nMore.";
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children.map((node) => node.type)).toEqual([
      "Header",
      "Header",
      "Paragraph",
      "Header",
      "Paragraph",
    ]);
    expect(ast.children[0]).toMatchObject({
      depth: 1,
      raw: "= Manual",
      range: [0, 8],
    });
    expect(ast.children[1]).toMatchObject({
      depth: 2,
      raw: "== Read *teh* guide",
      loc: { end: { line: 3, column: 19 } },
    });
    expect(ast.children[3]).toMatchObject({ depth: 3, raw: "=== Details" });
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text.replace("teh", "the"),
    );
  });
  it("converts discrete headings without consuming their metadata", () => {
    expect(parse("[discrete]\n== Heading\n\nText.").children[0]).toMatchObject({
      type: "Header",
      depth: 2,
      raw: "== Heading",
      range: [11, 21],
    });
  });
});

describe("code", () => {
  it.each(["`teh`", "``teh``"])("keeps %s out of prose rules", async (code) => {
    const text = `Use ${code} here.`;
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children[0]).toMatchObject({
      children: [
        { type: "Str" },
        { type: "Code", raw: code, value: "teh" },
        { type: "Str" },
      ],
    });
    expect(
      (await new TextlintKernel().lintText(text, options)).messages,
    ).toEqual([]);
  });
  it.each(["----", "...."])(
    "excludes a %s block but fixes subsequent prose",
    async (delimiter) => {
      const text = `${delimiter}\nteh\n${delimiter}\n\nRead teh manual.`;
      const ast = parse(text);
      assertAST({ ...ast });
      expect(ast.children[0]).toMatchObject({
        type: "CodeBlock",
        value: "teh",
      });
      const kernel = new TextlintKernel();
      expect((await kernel.lintText(text, options)).messages).toHaveLength(1);
      expect((await kernel.fixText(text, options)).output).toBe(
        `${delimiter}\nteh\n${delimiter}\n\nRead the manual.`,
      );
    },
  );
  it("preserves a source block's language", () => {
    expect(
      parse("[source,js]\n----\nconst value = 1;\n----").children[0],
    ).toMatchObject({
      type: "CodeBlock",
      lang: "js",
      value: "const value = 1;",
    });
  });
});

describe("links and images", () => {
  it.each([
    "https://example.com[Read *teh* guide]",
    "link:guide.html[Read _teh_ guide]",
  ])("fixes only the label of %s", async (text) => {
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children[0]).toMatchObject({
      children: [
        {
          type: "Link",
          children: [
            { type: "Str", value: "Read " },
            { children: [{ type: "Str", value: "teh" }] },
            { type: "Str", value: " guide" },
          ],
        },
      ],
    });
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text.replace("teh", "the"),
    );
  });
  it.each(["https://example.com", "https://example.com[]"])(
    "maps an unlabelled link %s",
    (text) => {
      expect(parse(text).children[0]).toMatchObject({
        children: [
          {
            type: "Link",
            url: "https://example.com",
            children: [
              { type: "Str", raw: "https://example.com", range: [0, 19] },
            ],
          },
        ],
      });
    },
  );
  it.each(["image:icon.png[Icon]", "image::icon.png[Icon]"])(
    "maps image URL and alternative text for %s",
    (text) => {
      const ast = parse(text);
      assertAST({ ...ast });
      expect(ast.children[0]).toMatchObject({
        children: [{ type: "Image", raw: text, url: "icon.png", alt: "Icon" }],
      });
    },
  );
});

describe("lists", () => {
  it("preserves nested lists and continued paragraphs", async () => {
    const text = "* First\n** Read teh guide\n* Second\n+\nMore text.";
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children[0]).toMatchObject({
      type: "List",
      ordered: false,
      children: [
        {
          type: "ListItem",
          children: [
            { type: "Paragraph" },
            { type: "List", children: [{ type: "ListItem" }] },
          ],
        },
        {
          type: "ListItem",
          children: [
            { type: "Paragraph" },
            { type: "Paragraph", raw: "More text." },
          ],
        },
      ],
    });
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text.replace("teh", "the"),
    );
  });
  it.each(["[start=3]\n. Three\n. Four", "3. Three\n4. Four"])(
    "keeps ordered list start: %s",
    (text) => {
      expect(parse(text).children[0]).toMatchObject({
        type: "List",
        ordered: true,
        start: 3,
      });
    },
  );
  it("keeps task states and repeated item locations", async () => {
    const text = "* [x] teh\n* [ ] teh";
    expect(parse(text).children[0]).toMatchObject({
      children: [
        { checked: true, loc: { start: { line: 1, column: 0 } } },
        { checked: false, loc: { start: { line: 2, column: 0 } } },
      ],
    });
    const kernel = new TextlintKernel();
    expect(
      (await kernel.lintText(text, options)).messages.map((message) => [
        message.line,
        message.column,
      ]),
    ).toEqual([
      [1, 7],
      [2, 7],
    ]);
    expect((await kernel.fixText(text, options)).output).toBe(
      "* [x] the\n* [ ] the",
    );
  });
});

describe("block containers and tables", () => {
  it("keeps quotes distinct and exposes admonition and example prose", async () => {
    const text =
      "____\nRead teh quote.\n____\n\nNOTE: Read teh note.\n\n====\nRead teh example.\n====";
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children.map((node) => node.type)).toEqual([
      "BlockQuote",
      "Paragraph",
      "Paragraph",
    ]);
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text.replaceAll("teh", "the"),
    );
  });
  it("lints block captions without linting code", async () => {
    const text = ".Read teh example\n[source,js]\n----\nteh\n----";
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children.map((node) => node.type)).toEqual([
      "Paragraph",
      "CodeBlock",
    ]);
    expect(ast.children[0].raw).toBe("Read teh example");
    expect((await new TextlintKernel().fixText(text, options)).output).toBe(
      text.replace("teh", "the"),
    );
  });
  it("maps headers and repeated cells with distinct fix ranges", async () => {
    const text = "|===\n|First |Second\n\n|teh |teh\n|===";
    const ast = parse(text);
    assertAST({ ...ast });
    expect(ast.children[0]).toMatchObject({
      type: "Table",
      children: [
        {
          type: "TableRow",
          children: [{ type: "TableCell" }, { type: "TableCell" }],
        },
        {
          type: "TableRow",
          children: [
            { type: "TableCell", raw: "teh" },
            { type: "TableCell", raw: "teh" },
          ],
        },
      ],
    });
    const kernel = new TextlintKernel();
    expect(
      (await kernel.lintText(text, options)).messages.map((message) => [
        message.line,
        message.column,
      ]),
    ).toEqual([
      [4, 2],
      [4, 7],
    ]);
    expect((await kernel.fixText(text, options)).output).toBe(
      text.replaceAll("teh", "the"),
    );
  });
  it("does not invent positions for empty table cells", () => {
    expect(() => parse("|===\n| |Text\n|===")).toThrow(/table cell/);
  });
  it("maps thematic breaks", () => {
    expect(parse("***").children[0]).toMatchObject({
      type: "HorizontalRule",
      range: [0, 3],
    });
  });
});
