use wasm_bindgen::prelude::*;

/// Return the parser's ASG and diagnostics without converting to HTML or TxtAST.
#[wasm_bindgen(js_name = parseAsciiDoc)]
pub fn parse_asciidoc(source: &str) -> Result<String, JsError> {
    let options = acdc_parser::Options::builder()
        .with_safe_mode(acdc_parser::SafeMode::Secure)
        .build()
        .map_err(|error| JsError::new(&error.to_string()))?;
    let parsed =
        acdc_parser::parse(source, &options).map_err(|error| JsError::new(&error.to_string()))?;
    let warnings: Vec<String> = parsed.warnings().iter().map(ToString::to_string).collect();
    let warning_kinds: Vec<&str> = parsed
        .warnings()
        .iter()
        .map(|warning| match warning.kind {
            acdc_parser::WarningKind::UnresolvedReference { .. } => "unresolved-reference",
            acdc_parser::WarningKind::NonStandardAuthorLine { .. } => "non-standard-author-line",
            _ => "other",
        })
        .collect();
    let result = serde_json::json!({
        "document": parsed.document(),
        "warnings": warnings,
        "warningKinds": warning_kinds,
        "warningLocations": parsed.warnings().iter().map(|warning| warning.source_location().map(|source| &source.location)).collect::<Vec<_>>(),
        "sourceRecovery": parsed.source_recovery().is_some(),
    });
    serde_json::to_string(&result).map_err(|error| JsError::new(&error.to_string()))
}
