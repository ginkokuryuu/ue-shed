//! Checks a package's decoded text against the text Unreal's gather reads from the same package.
//!
//! Properties the reader cannot decode are common (native Niagara structs, for example) and most
//! hold no text. The package's gatherable text table lists the localizable text it contributes, so
//! text coverage is complete when every runtime entry in that table was decoded.

use std::collections::BTreeSet;

use uasset_parser::Package;
use uasset_parser::gatherable_text::{
    gather_reads_table, read_gatherable_text, strip_package_namespace,
};
use uasset_parser::package::PackageError;

use crate::projection::{TextIdentity, TextOccurrence};

/// Namespace and key of every keyed text occurrence decoded from one package.
#[derive(Clone, Debug, Default)]
pub struct DecodedTextKeys(BTreeSet<(String, String)>);

impl DecodedTextKeys {
    pub fn record<'a>(&mut self, occurrences: impl IntoIterator<Item = &'a TextOccurrence>) {
        for occurrence in occurrences {
            if let TextIdentity::Resolved { namespace, key } = &occurrence.identity {
                self.0
                    .insert((strip_package_namespace(namespace).to_owned(), key.clone()));
            }
        }
    }

    fn contains(&self, namespace: &str, key: &str) -> bool {
        self.0.contains(&(namespace.to_owned(), key.to_owned()))
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

/// A runtime gatherable text site whose namespace and key no decoded occurrence matches.
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
    let Some(entries) = read_gatherable_text(source, &package.summary)? else {
        return Ok(None);
    };
    let mut coverage = GatherCoverage::default();
    for entry in entries {
        for site in entry.sites {
            if site.is_editor_only {
                continue;
            }
            coverage.runtime_sites += 1;
            if decoded.contains(&entry.namespace, &site.key) {
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
    Ok(Some(coverage))
}
