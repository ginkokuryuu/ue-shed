import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SavedAssetPackageTextRecord } from "@ue-shed/unreal-assets";
import { emptyPackageTextRecord } from "./package-text-record.js";
import { mountPackageTextEvent, mountedPackageName } from "./package-object-path.js";

const root = join("D:", "Projects", "Game");

describe("package object paths", () => {
	it("names a Content package as Unreal mounts it, and nothing else", () => {
		expect(mountedPackageName(root, "Content/Data/DT_Items.uasset")).toBe(
			"/Game/Data/DT_Items"
		);
		expect(mountedPackageName(root, join(root, "Content", "Maps", "L_Main.umap"))).toBe(
			"/Game/Maps/L_Main"
		);
		expect(mountedPackageName(root, "Plugins/Tool/Content/T.uasset")).toBeUndefined();
		expect(mountedPackageName(root, "Content/Data/DT_Items.uexp")).toBeUndefined();
	});

	it("completes package-relative paths in occurrences and gap samples, once", () => {
		const record: SavedAssetPackageTextRecord = {
			...emptyPackageTextRecord("Content/Data/DT_Items.uasset"),
			status: "partial",
			occurrences: [
				{
					source: "Sword",
					dev_notes: "",
					identity: { status: "resolved", namespace: "Items", key: "Sword" },
					location: {
						kind: "data_table_cell",
						object_path: "DT_Items",
						row: "Sword",
						property_path: "Name"
					},
					edit_capability: "source_editable"
				},
				{
					source: "Title",
					dev_notes: "",
					identity: { status: "unresolved", reason: "culture_invariant" },
					location: {
						kind: "asset_property",
						object_path: "DT_Items:Preview",
						class_path: "DT_Items_C",
						property_path: "Title"
					},
					edit_capability: "read_only"
				}
			],
			gapSamples: [
				{
					object_path: "DT_Items",
					property_path: "Notes",
					reason: "unsupported_text_history"
				}
			]
		};
		const mounted = mountPackageTextEvent(root, record);
		expect(mounted).toMatchObject({
			occurrences: [
				{ location: { object_path: "/Game/Data/DT_Items.DT_Items" } },
				{
					location: {
						object_path: "/Game/Data/DT_Items.DT_Items:Preview",
						class_path: "/Game/Data/DT_Items.DT_Items_C"
					}
				}
			],
			gapSamples: [{ object_path: "/Game/Data/DT_Items.DT_Items" }]
		});
		expect(mountPackageTextEvent(root, mounted)).toBe(mounted);
	});

	it("leaves saved full paths and files outside Content as they are", () => {
		const occurrence = {
			source: "Menu",
			dev_notes: "",
			identity: { status: "resolved", namespace: "UI", key: "Menu" },
			location: {
				kind: "asset_property",
				object_path: "/Game/UI/Menu.Menu",
				class_path: "/Script/Engine.DataAsset",
				property_path: "Label"
			},
			edit_capability: "read_only"
		} as const;
		const full = {
			...emptyPackageTextRecord("Content/UI/Menu.uasset"),
			occurrences: [occurrence]
		};
		expect(mountPackageTextEvent(root, full)).toBe(full);
		const outside = {
			...emptyPackageTextRecord("Plugins/Tool/Content/Menu.uasset"),
			occurrences: [
				{ ...occurrence, location: { ...occurrence.location, object_path: "Menu" } }
			]
		};
		expect(mountPackageTextEvent(root, outside)).toBe(outside);
	});

	it("completes streamed occurrences and coverage gaps", () => {
		expect(
			mountPackageTextEvent(root, {
				event: "text_occurrence",
				schema_version: 1,
				path: "Content/Text/ST_Menu.uasset",
				fileBytes: 0,
				occurrence: {
					source: "Play",
					dev_notes: "",
					identity: { status: "resolved", namespace: "Menu", key: "Play" },
					location: {
						kind: "string_table_entry",
						object_path: "ST_Menu",
						entry_key: "Play"
					},
					edit_capability: "source_editable"
				}
			})
		).toMatchObject({
			occurrence: { location: { object_path: "/Game/Text/ST_Menu.ST_Menu" } }
		});
		expect(
			mountPackageTextEvent(root, {
				event: "text_coverage_gap",
				schema_version: 1,
				path: "Content/Text/ST_Menu.uasset",
				coverage_gap: {
					object_path: "ST_Menu",
					property_path: "Entries",
					reason: "property_decoder_rejected"
				}
			})
		).toMatchObject({ coverage_gap: { object_path: "/Game/Text/ST_Menu.ST_Menu" } });
	});
});
