//! A flat overlay retains exactly one immutable base. A full Rust merge supplies its values.
use crate::join::{JoinInput, JoinOutcome};
use crate::join_columns::{column, layer};
use crate::store::{Store, section};
use crate::{Result, require};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
type Columns = Vec<(String, String, Vec<u32>)>;

fn same_columns(
    store: &Store,
    before: &str,
    after: &str,
    ignored: &[&str],
    fields: Option<&[&str]>,
) -> Result<bool> {
    let Some((mut a, ar)) = layer(store, before)? else {
        return Ok(false);
    };
    let Some((mut b, br)) = layer(store, after)? else {
        return Ok(false);
    };
    let names = if let Some(fields) = fields {
        fields.iter().map(|s| s.to_string()).collect::<Vec<_>>()
    } else {
        a.entries
            .iter()
            .map(|e| e.name.clone())
            .filter(|name| !ignored.contains(&name.as_str()))
            .collect()
    };
    for name in names {
        if !b.entries.iter().any(|e| e.name == name)
            || column(&mut a, &ar, &name)? != column(&mut b, &br, &name)?
        {
            return Ok(false);
        }
    }
    Ok(true)
}
/// Overlay eligibility is deliberately conservative, matching Phase 6's structural fallbacks.
pub(crate) fn publish(
    store: &mut Store,
    input: &JoinInput,
    key: &str,
    meta: &Value,
    columns: &Columns,
) -> Result<Option<JoinOutcome>> {
    if input.force == Some(true) {
        return Ok(None);
    }
    let Some(previous_key) = store.root["active"]["joined"].as_str().map(str::to_owned) else {
        return Ok(None);
    };
    if !previous_key.starts_with("joined-v10:") {
        return Ok(None);
    }
    let (mut previous, previous_record) =
        layer(store, &previous_key)?.ok_or("joined record absent")?;
    let previous_bytes = section(&mut previous, "join.meta")?;
    let prior = match serde_json::from_slice::<Value>(&previous_bytes) {
        Ok(mut prior) => {
            prior["input"] = crate::join::policy_view(&prior["input"], &BTreeMap::new());
            prior
        }
        Err(_) => match crate::json_value::parse(std::str::from_utf8(&previous_bytes)?) {
            Ok(prior) => prior,
            Err(_) => return Ok(None),
        },
    };
    if prior["generation"] != meta["generation"]
        || prior["oldCandidates"] != 0
        || prior["count"] != meta["count"]
    {
        return Ok(None);
    }
    for field in ["projectRoot", "target", "review", "keyChangePairs"] {
        let current = if matches!(field, "projectRoot" | "target") {
            crate::join::policy_view(&meta["input"][field], &BTreeMap::new())
        } else {
            meta["input"][field].clone()
        };
        if prior["input"][field] != current {
            return Ok(None);
        }
    }
    let empty = json!({});
    if prior["input"].get("fileErrors").unwrap_or(&empty)
        != meta["input"].get("fileErrors").unwrap_or(&empty)
    {
        return Ok(None);
    }
    let old = prior["dependencies"]
        .as_object()
        .ok_or("joined dependencies")?;
    let new = meta["dependencies"]
        .as_object()
        .ok_or("joined dependencies")?;
    if old.len() != new.len() || new.keys().any(|name| !old.contains_key(name)) {
        return Ok(None);
    }
    let changed = new
        .iter()
        .filter(|(name, value)| old.get(*name) != Some(*value))
        .collect::<Vec<_>>();
    if changed.is_empty() {
        return Ok(None);
    }
    let po_names = input.target["outputPaths"]["portableObjects"]
        .as_object()
        .ok_or("target portable paths")?;
    for (name, current) in changed {
        let before = old[name].as_str().ok_or("old dependency key")?;
        let after = current.as_str().ok_or("dependency key")?;
        if name.starts_with("package-text.") {
            if !same_columns(
                store,
                before,
                after,
                &["shared.meta", "package.signature", "occurrence.source"],
                None,
            )? {
                return Ok(None);
            }
        } else if po_names.values().any(|v| v == name) {
            if !same_columns(
                store,
                before,
                after,
                &[],
                Some(&["entry.namespace", "entry.key", "entry.ordinal"]),
            )? {
                return Ok(None);
            }
            let (mut a, ar) = layer(store, before)?.ok_or("previous PO")?;
            let (mut b, br) = layer(store, after)?.ok_or("current PO")?;
            let am: Value = serde_json::from_slice(&section(&mut a, "file.meta")?)?;
            let bm: Value = serde_json::from_slice(&section(&mut b, "file.meta")?)?;
            if am["hasSourceText"] != bm["hasSourceText"] {
                return Ok(None);
            }
            let ao = column(&mut a, &ar, "entry.options")?;
            let bo = column(&mut b, &br, "entry.options")?;
            if ao.len() != bo.len() || ao.iter().zip(bo).any(|(a, b)| a & 16 != b & 16) {
                return Ok(None);
            }
        } else {
            return Ok(None);
        }
    }
    let base = prior["base"].as_str().unwrap_or(&previous_key).to_owned();
    if key == base {
        return Ok(None);
    }
    if prior.get("base").is_some() {
        require(
            store.root["active"]["joined-base"] == base,
            "joined overlay base not retained",
        )?;
    }
    let (mut base_reader, base_record) = layer(store, &base)?.ok_or("joined base absent")?;
    let mut logical = BTreeMap::new();
    for (name, domain, values) in columns {
        logical.insert(name.clone(), (domain.clone(), values));
    }
    for (alias, canonical) in meta["aliases"].as_object().ok_or("new joined aliases")? {
        let entry = logical
            .get(canonical.as_str().ok_or("alias")?)
            .ok_or("canonical column absent")?
            .clone();
        logical.insert(alias.clone(), entry);
    }
    let mut patches = BTreeMap::<String, (String, Vec<u32>, Vec<u32>)>::new();
    let mut rows = BTreeSet::new();
    for (name, (domain, values)) in logical {
        let canonical = prior["aliases"][&name].as_str().unwrap_or(&name);
        if !base_reader.entries.iter().any(|e| e.name == canonical) {
            return Ok(None);
        }
        let before = column(&mut base_reader, &base_record, canonical)?;
        if before.len() != values.len() {
            return Ok(None);
        }
        let changed = (0..values.len())
            .filter(|row| before[*row] != values[*row])
            .map(|row| row as u32)
            .collect::<Vec<_>>();
        if changed.is_empty() {
            continue;
        }
        if changed.len() > 8192 {
            return Ok(None);
        }
        if !name.starts_with("query.") {
            if !name.starts_with("line.") && !name.starts_with('c') {
                return Ok(None);
            }
            rows.extend(&changed);
        }
        patches.insert(name, (domain, changed, values.clone()));
    }
    if rows.len() > 8192 {
        return Ok(None);
    }
    let rows = rows.into_iter().collect::<Vec<_>>();
    let mut physical = vec![("patch.rows".into(), String::new(), rows.clone())];
    let mut fields = serde_json::Map::new();
    let mut field_rows = serde_json::Map::new();
    for (name, (domain, changed, values)) in patches {
        let selected = if name.starts_with("query.") {
            changed
        } else {
            rows.clone()
        };
        let patch = format!("patch.{}", physical.len());
        fields.insert(name.clone(), json!(patch));
        if name.starts_with("query.") {
            let indices = format!("{patch}.rows");
            field_rows.insert(name, json!(indices));
            physical.push((indices, String::new(), selected.clone()));
        }
        physical.push((
            patch,
            domain,
            selected.iter().map(|row| values[*row as usize]).collect(),
        ));
    }
    let mut metadata = meta.clone();
    metadata["aliases"] = prior["aliases"].clone();
    metadata["base"] = json!(base);
    metadata["patches"] = json!(fields);
    metadata["patchRows"] = json!(field_rows);
    let record = store.publish_global(
        "joined",
        key,
        &physical,
        &crate::join::metadata_bytes(&metadata)?,
        &BTreeMap::from([("joined-base".into(), base)]),
        &[],
    )?;
    let _ = previous_record;
    Ok(Some(JoinOutcome {
        rebuilt: true,
        strategy: Some("incremental".into()),
        key: key.into(),
        bytes: record["bytes"].as_u64().ok_or("overlay bytes")?
            + base_record["bytes"].as_u64().ok_or("base bytes")?,
        count: meta["count"].as_u64().map(|v| v as u32),
        key_changes: Some(meta["pairs"].as_array().ok_or("pairs")?.len() as u32),
        affected_lines: Some(rows.len() as u32),
    }))
}
