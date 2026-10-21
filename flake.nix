{
  description = "Development environment for the acdc-based textlint AsciiDoc plugin";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { nixpkgs, rust-overlay, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor =
        system:
        import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
          # flake.lock pins "latest", including the matching WASM standard library.
          rust = pkgs.rust-bin.stable.latest.minimal.override {
            extensions = [
              "clippy"
              "rustfmt"
              "rust-analyzer"
              "rust-src"
            ];
            targets = [ "wasm32-unknown-unknown" ];
          };
        in
        {
          default = pkgs.mkShell {
            packages = [
              rust
              pkgs.nodejs_24
              pkgs.pnpm
              pkgs.wasm-pack
              pkgs.wasm-bindgen-cli
              pkgs.binaryen # wasm-opt
              pkgs.git
              pkgs.nixfmt
            ];
          };
        }
      );

      formatter = forAllSystems (system: (pkgsFor system).nixfmt);
    };
}
