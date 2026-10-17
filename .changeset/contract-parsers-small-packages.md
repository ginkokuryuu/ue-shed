---
"@ue-shed/map-history": minor
"@ue-shed/observatory": minor
"@ue-shed/project-custodian": minor
---

**Breaking:** exported raw decoders are unary domain parsers. Each package's parsers fail with its own contract error (`code: "invalid_contract"`, `message` naming the value, `recovery`, `retrySafe`, and the schema issue as `cause`) instead of Schema's parse error:

- `@ue-shed/map-history`: `decodePerforceMapHistoryQuery`, `decodePerforceMapHistory`, `decodePerforceFastMapHistoryQuery`, `decodePerforceFastMapHistory`, `decodeMapHistoryQuery` and `decodeMapHistoryResult` become `parse*`, failing with `MapHistoryContractError`.
- `@ue-shed/observatory`: `decodeWorldScoutResult` and `decodeWorldScoutFocusResult` become `parse*`, failing with `WorldScoutContractError`.
- `@ue-shed/project-custodian`: `decodeCustodianScanRequest`, `decodeCustodianReport`, `decodeCustodianPrepareRequest`, `decodeCustodianProposal`, `decodeCustodianExecuteRequest` and `decodeCustodianReceipt` become `parse*`, failing with `CustodianContractError`.

The private `@ue-shed/scenarios` package and the Map Capture, Content Observatory and Project Custodian extension clients get the same change, with `ScenarioContractError`, `MapCaptureContractError`, `ContentObservatoryContractError` and `CustodianClientContractError`.

Migration: rename `decode*` to `parse*`, and handle the package's contract error where you handled a `SchemaError`.
