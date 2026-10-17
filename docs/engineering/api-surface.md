# API surface of the host-facing packages

Plan 058 D13 repeats the `game-text` API review (D1) for the other packages hosts use. The first
step is a measurement, so cuts are made from evidence rather than taste.

## How it is measured

`node scripts/measure-package-exports.ts [--json] [package ...]` reads each package's `exports` map,
asks the TypeScript checker for every name each entry point exports, and scans `apps/`,
`packages/`, `extensions/` and `scripts/` for imports and re-exports of those names by entry point.

- A namespace import or `export *` of an entry point counts all of its names as used.
- Uses inside the package itself are not counted.
- Uses in other repositories are invisible here. That includes downstream hosts, which matter most for published packages.
- "Unused" means "not imported by name in this repository". It does not mean safe to delete. Many such names are types that appear in the signatures of used exports, error classes callers match on, or test layers documented for hosts.

Run with `--json` for the full lists of unused names per entry point.

## Measurement (2026-10-17, `origin/main` after PR #99)

| Package                      | Entry point             | Used outside / exported |
| ---------------------------- | ----------------------- | ----------------------- |
| `@ue-shed/protocol`          | `.`                     | 143 / 238               |
| `@ue-shed/unreal-connection` | `.`                     | 15 / 21                 |
| `@ue-shed/localization`      | `.`                     | 63 / 139                |
|                              | `./browser`             | 38 / 118                |
| `@ue-shed/unreal-assets`     | `.`                     | 67 / 160                |
|                              | `./investigation`       | 8 / 9                   |
|                              | `./text-extraction`     | 1 / 1                   |
|                              | `./investigation-files` | 2 / 2                   |
|                              | `./saved-review`        | 7 / 11                  |
| `@ue-shed/engine`            | `.`                     | 30 / 83                 |
| `@ue-shed/cameras`           | `.`                     | 105 / 485               |
|                              | `./review-contracts`    | 31 / 40                 |
|                              | `./map-tiles`           | 18 / 59                 |
|                              | `./browser`             | 25 / 279                |
| `@ue-shed/host` (private)    | `.`                     | 13 / 26, now 13 / 13    |

Every published entry point above is built with `export *` over its modules, so any new export
becomes public by accident.

The largest gaps are `cameras` (684 of 863 names not imported outside the package) and the
`localization` browser entry (80 of 118). In `cameras` most unused names are schemas, intent
decoders and test layers that the map-review and camera-authoring flows reach only through the
package's own services.

## Cuts

- **`@ue-shed/host`**: a private package with one consumer (decision 9). Its entry point now
  lists its 13 used names; the other 13 (configuration value types, the file-picker layer, the
  saved-table index layer and test layer, the sessions layer) are private.
- **`unreal-connection`, `unreal-assets` and `cameras`**: measurement only. Lane D's D4 is
  changing their error classes, so this lane changes neither their export lists nor their entry
  points.
- **`protocol`, `localization` and `engine`**: published packages with downstream hosts
  whose imports are not visible here. Their unused names are candidates, not cuts. The next step
  for each is the D1 pattern:
    - named-export entry points instead of `export *`;
    - checked against the downstream host's actual imports;
    - private schemas and helpers dropped in the same release.
