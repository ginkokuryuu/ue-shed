//! The exports a Blueprint's compile saves beside it: the class it generates, that class's default
//! object, and, when one was saved, the skeleton class and its default object.
//!
//! Unreal duplicates authored subobjects into these classes, so the same text is saved several
//! times in one package. Game Text folds the copies back into the authored site; the facts here
//! come from the export table and the Blueprint's saved `GeneratedClass`, never from object names
//! alone, so an asset whose own name ends in `_C` is never mistaken for a class.

use serde::{Deserialize, Serialize};
use uasset_parser::asset::DecodedAsset;
use uasset_parser::package::{Package, PackageIndex};
use uasset_parser::property::PropertyValue;

/// `RF_ClassDefaultObject`: the export is its class's default object.
const RF_CLASS_DEFAULT_OBJECT: u32 = 0x0000_0010;

/// One Blueprint in a package and the classes and default objects its compile saved there.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedAssetBlueprintClasses {
    pub blueprint: String,
    pub generated_class: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub class_default: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skeleton_class: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skeleton_class_default: Option<String>,
}

/// The Blueprint's classes when `asset` is a decoded object whose saved `GeneratedClass` names an
/// export of the same package. `SkeletonGeneratedClass` is transient, so a saved skeleton class is
/// the top-level export of the generated class's own class named `SKEL_` plus its name, which is
/// how the Kismet compiler names it.
#[must_use]
pub fn blueprint_classes(
    package: &Package,
    asset: &DecodedAsset,
) -> Option<SavedAssetBlueprintClasses> {
    let DecodedAsset::UObject(object) = asset else {
        return None;
    };
    let generated = object.properties.records.iter().find_map(|record| {
        if package.resolve_name_str(record.name) != Some("GeneratedClass") {
            return None;
        }
        match record.value {
            PropertyValue::ObjectRef(PackageIndex::Export(index)) => Some(index),
            _ => None,
        }
    })?;
    let generated_export = package.exports.get(usize::try_from(generated).ok()?)?;
    let generated_name = package.resolve_name_cow(generated_export.object_name)?;
    let skeleton_name = format!("SKEL_{generated_name}");
    let skeleton = package
        .exports
        .iter()
        .enumerate()
        .find(|(index, export)| {
            u32::try_from(*index).ok() != Some(generated)
                && export.outer_index == PackageIndex::Null
                && export.class_index == generated_export.class_index
                && package
                    .resolve_name_cow(export.object_name)
                    .is_some_and(|name| name == skeleton_name.as_str())
        })
        .and_then(|(index, _)| u32::try_from(index).ok());
    Some(SavedAssetBlueprintClasses {
        blueprint: object.object_path.to_string(),
        generated_class: generated_export.object_path.to_string(),
        class_default: class_default(package, generated),
        skeleton_class: skeleton
            .and_then(|index| package.exports.get(index as usize))
            .map(|export| export.object_path.to_string()),
        skeleton_class_default: skeleton.and_then(|index| class_default(package, index)),
    })
}

/// The single export flagged as the default object of the class export at `class`.
fn class_default(package: &Package, class: u32) -> Option<String> {
    let mut defaults = package.exports.iter().filter(|export| {
        export.object_flags & RF_CLASS_DEFAULT_OBJECT != 0
            && export.class_index == PackageIndex::Export(class)
    });
    let first = defaults.next()?;
    defaults
        .next()
        .is_none()
        .then(|| first.object_path.to_string())
}
