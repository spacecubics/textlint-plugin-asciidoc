# textlint-plugin-asciidoc

Lint AsciiDoc with textlint, using acdc via WebAssembly.

## Use with textlint

Requires Node.js 24 and pnpm. Release packages include compiled JavaScript
and WASM; Rust is only needed when building from source.

1. Install a release in your documentation project. Replace `<tag>` with
   an available release tag. Use the attached `.tgz`, not GitHub's source archive.

   ```sh
   pnpm add -D textlint textlint-rule-preset-ja-technical-writing textlint-filter-rule-comments \
     "https://github.com/spacecubics/textlint-plugin-asciidoc/releases/download/<tag>/textlint-plugin-asciidoc.tgz"
   ```

2. Create `.textlintrc.json`. This example uses Japanese technical-writing rules.

   ```json
   {
     "plugins": { "asciidoc": true },
     "rules": { "preset-ja-technical-writing": true },
     "filters": { "comments": true }
   }
   ```

3. Check your documents:

   ```sh
   pnpm exec textlint "ja/**/*.adoc"
   ```

   Exit code `1` means lint errors were found. Add `--fix` to apply automatic
   fixes. Use `// textlint-disable` and `// textlint-enable` to suppress rules.

## Build and check locally

1. From this repository, enter the Nix shell and build:

   ```sh
   nix develop
   pnpm install --frozen-lockfile
   pnpm build
   ```

2. Run the checks:

   ```sh
   pnpm check
   pnpm typecheck
   pnpm test
   ```

To try the local build in another project, replace the release URL in the
installation command with `"link:/absolute/path/to/textlint-plugin-asciidoc"`.
Rebuild the plugin after changing its source.

## Current limitations

Unsupported elements with known source ranges are kept as opaque code so
surrounding prose remains lintable. Syntax errors and unsafe source mappings
still produce errors.

- **UI and raw content:** keyboard/button/menu macros, passthroughs, media,
  formulas and hidden index terms are excluded from prose checks.
- **Tables:** CSV, custom separators and duplicated cells are excluded as whole
  tables. Complex supported cells are flattened into blocks, losing table structure.
- **Conditionals:** balanced `ifdef`, `ifndef` and `ifeval` regions are excluded
  regardless of whether their conditions would be true.
- **Attributes and includes:** attribute definitions and references are excluded;
  includes are not expanded. Lint included files separately.
- **References:** explicit xref labels are linted, but targets and generated
  labels are not resolved. Antora integration is not implemented.
