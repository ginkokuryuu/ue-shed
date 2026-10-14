//! Checks a package's decoded text against the text Unreal's gather reads from the same package.
//!
//! Properties the reader cannot decode are common (native Niagara structs, for example) and most
//! hold no text. The package's gatherable text table lists the localizable text it contributes, so
//! text coverage is complete when every runtime entry in that table was decoded.

use std::collections::BTreeSet;

use uasset_parser::Package;
use uasset_parser::gatherable_text::{
    GatherableText, gather_reads_table, read_gatherable_text, strip_package_namespace,
};
use uasset_parser::package::PackageError;

use crate::projection::{TextIdentity, TextLocation, TextOccurrence};

/// Namespace, key and source string of every keyed text occurrence decoded from one package.
///
/// Unreal gathers one entry per namespace and source string (UE 5.7 and 5.8
/// `FPropertyLocalizationDataGatherer`), so a decoded key only covers the entry with the same
/// source; a different source under the same key is separate text.
#[derive(Clone, Debug, Default)]
pub struct DecodedTextKeys(BTreeSet<(String, String, String)>);

impl DecodedTextKeys {
    pub fn record<'a>(&mut self, occurrences: impl IntoIterator<Item = &'a TextOccurrence>) {
        for occurrence in occurrences {
            if let TextIdentity::Resolved { namespace, key } = &occurrence.identity {
                // Gather strips the package marker from a serialized FText namespace once.
                // String Tables gather their authored namespace verbatim.
                let namespace = match occurrence.location {
                    TextLocation::StringTableEntry { .. } => namespace,
                    _ => strip_package_namespace(namespace),
                };
                self.0
                    .insert((namespace.to_owned(), key.clone(), occurrence.source.clone()));
            }
        }
    }

    fn contains(&self, namespace: &str, key: &str, source: &str) -> bool {
        self.0
            .contains(&(namespace.to_owned(), key.to_owned(), source.to_owned()))
    }
}

/// Missing sites kept per package, matching the coverage gap sample bound.
pub const MAX_MISSING_GATHERABLE_TEXT_SAMPLES: usize = 3;

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct GatherCoverage {
    /// Runtime (not editor-only) site contexts in the package's gatherable text table.
    pub runtime_sites: u64,
    /// Runtime sites that no decoded occurrence matched.
    pub missing: u64,
    /// The first missing sites, at most [`MAX_MISSING_GATHERABLE_TEXT_SAMPLES`].
    pub missing_samples: Vec<MissingGatherableText>,
}

/// A runtime gatherable text site whose namespace, key and source no decoded occurrence matches.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MissingGatherableText {
    pub namespace: String,
    pub key: String,
    pub source: String,
    /// Unreal's site path, for example `/Game/Map.Map:Actor.Component.Text`.
    pub site_description: String,
}

/// Compares decoded text with the package's gatherable text table.
///
/// Editor-only sites are skipped because Unreal's gather skips them by default. Returns `None`
/// when Unreal itself would not read the table (it predates the table, or the table may be
/// missing or stale), so there is nothing trustworthy to compare against. `path` is the package's
/// project or file path, used to recognize external actor packages.
///
/// # Errors
///
/// Returns an error if the package's gatherable text table cannot be read.
pub fn gather_coverage(
    source: &[u8],
    package: &Package,
    path: &str,
    decoded: &DecodedTextKeys,
) -> Result<Option<GatherCoverage>, PackageError> {
    if !gather_reads_table(package, path) {
        return Ok(None);
    }
    Ok(read_gatherable_text(source, &package.summary)?.map(|entries| compare(entries, decoded)))
}

fn compare(entries: Vec<GatherableText>, decoded: &DecodedTextKeys) -> GatherCoverage {
    let mut coverage = GatherCoverage::default();
    for entry in entries {
        for site in entry.sites {
            if site.is_editor_only {
                continue;
            }
            coverage.runtime_sites += 1;
            if decoded.contains(&entry.namespace, &site.key, &entry.source) {
                continue;
            }
            coverage.missing += 1;
            if coverage.missing_samples.len() < MAX_MISSING_GATHERABLE_TEXT_SAMPLES {
                coverage.missing_samples.push(MissingGatherableText {
                    namespace: entry.namespace.clone(),
                    key: site.key,
                    source: entry.source.clone(),
                    site_description: site.site_description,
                });
            }
        }
    }
    coverage
}

#[cfg(test)]
mod tests {
    use uasset_parser::gatherable_text::{GatherableText, GatherableTextSite};

    use super::{DecodedTextKeys, compare};
    use crate::projection::{TextEditCapability, TextIdentity, TextLocation, TextOccurrence};

    fn entry(namespace: &str, source: &str, key: &str) -> GatherableText {
        GatherableText {
            namespace: namespace.to_owned(),
            source: source.to_owned(),
            sites: vec![GatherableTextSite {
                key: key.to_owned(),
                site_description: format!("/Game/UI.UI:{key}"),
                is_editor_only: false,
                is_optional: false,
            }],
        }
    }

    fn occurrence(
        namespace: &str,
        key: &str,
        source: &str,
        location: TextLocation,
    ) -> TextOccurrence {
        TextOccurrence {
            source: source.to_owned(),
            dev_notes: String::new(),
            identity: TextIdentity::Resolved {
                namespace: namespace.to_owned(),
                key: key.to_owned(),
            },
            location,
            edit_capability: TextEditCapability::ReadOnly,
        }
    }

    fn property() -> TextLocation {
        TextLocation::AssetProperty {
            object_path: "/Game/UI.UI".to_owned(),
            class_path: "/Script/Engine.DataAsset".to_owned(),
            property_path: "Label".to_owned(),
        }
    }

    fn string_table_row(key: &str) -> TextLocation {
        TextLocation::StringTableEntry {
            object_path: "/Game/ST_Menu.ST_Menu".to_owned(),
            entry_key: key.to_owned(),
        }
    }

    fn decoded(occurrences: &[TextOccurrence]) -> DecodedTextKeys {
        let mut keys = DecodedTextKeys::default();
        keys.record(occurrences);
        keys
    }

    /// Gather saved `UI [Tutorial]` after stripping the FText's package marker; the decoded
    /// FText still carries it. Stripping the table namespace too reported this as unread.
    #[test]
    fn an_ftext_namespace_loses_only_its_package_marker() {
        let coverage = compare(
            vec![entry("UI [Tutorial]", "Next", "K")],
            &decoded(&[occurrence(
                "UI [Tutorial] [8D4F2A61B0C9E7F3]",
                "K",
                "Next",
                property(),
            )]),
        );
        assert_eq!((coverage.runtime_sites, coverage.missing), (1, 0));
    }

    /// String Tables gather their authored namespace without stripping anything.
    #[test]
    fn a_string_table_namespace_is_compared_verbatim() {
        let coverage = compare(
            vec![entry("Menu [Legacy]", "Quit", "Quit")],
            &decoded(&[occurrence(
                "Menu [Legacy]",
                "Quit",
                "Quit",
                string_table_row("Quit"),
            )]),
        );
        assert_eq!((coverage.runtime_sites, coverage.missing), (1, 0));

        // The authored suffix is part of the identity, so a different table stays missing.
        let coverage = compare(
            vec![entry("Menu [Legacy]", "Quit", "Quit")],
            &decoded(&[occurrence("Menu", "Quit", "Quit", string_table_row("Quit"))]),
        );
        assert_eq!(coverage.missing, 1);
    }

    /// Unreal gathers `UI/K = "Continue"` and `UI/K = "Delete"` as separate entries; decoding one
    /// source must leave the other missing.
    #[test]
    fn a_decoded_key_covers_only_its_own_source_string() {
        let coverage = compare(
            vec![entry("UI", "Continue", "K"), entry("UI", "Delete", "K")],
            &decoded(&[occurrence("UI", "K", "Continue", property())]),
        );
        assert_eq!((coverage.runtime_sites, coverage.missing), (2, 1));
        let samples: Vec<_> = coverage
            .missing_samples
            .iter()
            .map(|missing| {
                (
                    missing.namespace.as_str(),
                    missing.key.as_str(),
                    missing.source.as_str(),
                )
            })
            .collect();
        assert_eq!(samples, [("UI", "K", "Delete")]);
    }
}
