use std::fs;

use uasset_inspection::gather_coverage::{DecodedTextKeys, gather_coverage};
use uasset_inspection::projection::project_text_asset;
use uasset_parser::asset::{AssetDecodeContext, decode_export};
use uasset_parser::package::Package;

fn fixture(path: &str) -> (Vec<u8>, Package) {
    let bytes = fs::read(format!(
        "{}/../../fixtures/{path}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .expect("fixture package");
    let package = Package::parse(&bytes).expect("fixture parses");
    (bytes, package)
}

/// Decodes every export and returns the decoded keys plus the number of coverage gaps.
fn decode(bytes: &[u8], package: &Package) -> (DecodedTextKeys, usize) {
    let context = AssetDecodeContext {
        source: bytes,
        package,
        schemas: uasset_parser::schema::embedded_source_model(),
    };
    let mut keys = DecodedTextKeys::default();
    let mut gaps = 0;
    for export in &package.exports {
        if let Ok(Some(asset)) = decode_export(export, &context) {
            let projection = project_text_asset(package, &asset);
            keys.record(&projection.occurrences);
            gaps += projection.coverage_gaps.len();
        }
    }
    (keys, gaps)
}

#[test]
fn a_non_text_decoder_gap_leaves_gatherable_text_complete() {
    for engine in ["4.27", "5.3"] {
        let (bytes, package) = fixture(&format!(
            "legacy-unreal-project/Generated/{engine}/Content/Legacy/DT_LegacyText.uasset"
        ));
        let (keys, gaps) = decode(&bytes, &package);
        // The NativeVectors property is undecodable but holds no text.
        assert!(gaps > 0, "{engine}");
        let coverage = gather_coverage(&bytes, &package, "Fixture.uasset", &keys)
            .expect("gather table reads")
            .expect("package has a gather table");
        assert_eq!(coverage.runtime_sites, 8, "{engine}");
        assert_eq!(
            coverage.missing, 0,
            "{engine}: {:?}",
            coverage.missing_samples
        );
    }
}

#[test]
fn reports_runtime_gather_entries_that_were_not_decoded() {
    let (bytes, package) = fixture("unreal-project/Content/Fixture/Text/DA_TextOccurrences.uasset");
    let (keys, _) = decode(&bytes, &package);
    let complete = gather_coverage(&bytes, &package, "Fixture.uasset", &keys)
        .expect("gather table reads")
        .expect("package has a gather table");
    assert_eq!(complete.runtime_sites, 4);
    assert_eq!(complete.missing, 0);

    let coverage = gather_coverage(
        &bytes,
        &package,
        "Fixture.uasset",
        &DecodedTextKeys::default(),
    )
    .expect("gather table reads")
    .expect("package has a gather table");
    // Every missing site is counted; only the first three are kept as samples.
    assert_eq!(coverage.missing, 4);
    let samples: Vec<_> = coverage
        .missing_samples
        .iter()
        .map(|missing| (missing.key.as_str(), missing.source.as_str()))
        .collect();
    assert_eq!(
        samples,
        [
            ("SharedHoldPrompt", "Hold to skip"),
            ("SharedHoldPrompt", "Hold to skip"),
            ("ConfirmAction", "Confirm"),
        ]
    );
    assert_eq!(
        coverage.missing_samples[0].site_description,
        "/Game/Fixture/Text/DA_TextOccurrences.DA_TextOccurrences.SharedPrimary"
    );
}
