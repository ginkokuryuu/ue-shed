//! Read JSON metadata into reversible UTF-16 policy views, without scalar substitution.
use crate::Result;
use crate::wtf8::Wtf8Buf;
use serde::Deserialize;

pub(crate) fn parse(text: &str) -> Result<serde_json::Value> {
    let mut decoder = serde_json::Deserializer::from_str(text);
    serde::de::IgnoredAny::deserialize(&mut decoder)?;
    decoder.end()?;
    let mut output = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(character) = chars.next() {
        if character != '"' {
            output.push(character);
            continue;
        }
        let mut units = Vec::new();
        loop {
            let character = chars.next().ok_or("unterminated JSON string")?;
            match character {
                '"' => break,
                '\\' => {
                    let escape = chars.next().ok_or("unterminated JSON escape")?;
                    units.push(match escape {
                        '"' => 34,
                        '\\' => 92,
                        '/' => 47,
                        'b' => 8,
                        'f' => 12,
                        'n' => 10,
                        'r' => 13,
                        't' => 9,
                        'u' => {
                            let mut unit = 0;
                            for _ in 0..4 {
                                unit = unit * 16
                                    + chars
                                        .next()
                                        .and_then(|c| c.to_digit(16))
                                        .ok_or("invalid JSON Unicode escape")?
                                        as u16;
                            }
                            unit
                        }
                        _ => return Err("invalid JSON escape".into()),
                    });
                }
                character => units.extend_from_slice(character.encode_utf16(&mut [0; 2])),
            }
        }
        output.push_str(&serde_json::to_string(
            &Wtf8Buf::from_utf16(&units).into_view(),
        )?);
    }
    Ok(serde_json::from_str(&output)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_lone_units_pairs_object_keys_and_reserved_scalars() {
        let text = r#"{"\ud800":{"by":"lead\ud800","key":"\udfff","source":"𐀀","literal":"󰀁","escaped":"\\ud800\n"}}"#;
        assert_eq!(crate::wtf8::view_json(&parse(text).unwrap()).unwrap(), text);
        assert!(parse(r#"{"x":"\q"}"#).is_err());
        assert!(parse(r#"{"x":"\ud800"} false"#).is_err());
    }
}
