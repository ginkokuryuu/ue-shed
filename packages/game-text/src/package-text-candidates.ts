import type { ProjectIndexHeader } from "@ue-shed/unreal-assets";
import type { TextCorpus, TextCorpusDiagnostic, TextPackageCoverage } from "./schema.js";
import { HostSliceClock, runHostStepsSync, type HostSteps } from "./host-slices.js";

export const REQUIRES_LOCALIZATION_GATHER = 0x00040000;

/** Saved external-object layout relates an external package to its outer package.
 * Use the complete inventory, including packages outside a caller's changed selection.
 */
export function packageTextExternalReferences(paths: readonly string[]): ReadonlySet<string> {
	const scan = new PackageTextExternalScan();
	for (const path of paths) scan.visit(path);
	for (let index = 0; index < paths.length; index++) scan.revisit(index, paths[index]!);
	return scan.references;
}

/** The two-pass external-reference scan, advanced one path at a time for bounded host slices. */
export class PackageTextExternalScan {
	readonly references = new Set<string>();
	private readonly normalized: string[] = [];
	private readonly outers = new Set<string>();
	/** First pass: records external packages and the outer packages they name. */
	visit(path: string) {
		const normalized = path.replaceAll("\\", "/");
		this.normalized.push(normalized);
		const match =
			/^((?:.*\/)?Content\/)__(?:ExternalActors|ExternalObjects)__\/(.+)\/(?:[^/]+\/){2}[^/]+\.(?:uasset|umap)$/u.exec(
				normalized
			);
		if (match) {
			this.references.add(path);
			this.outers.add(`${match[1]}${match[2]}`);
		}
	}
	/** Without outer packages, the second pass cannot add a reference. */
	get hasOuters() {
		return this.outers.size > 0;
	}
	/** Second pass, by visit index: outer packages of external packages are references too. */
	revisit(index: number, path: string) {
		if (this.outers.has(this.normalized[index]!.replace(/\.(?:uasset|umap)$/u, "")))
			this.references.add(path);
	}
}

/** Header evidence is mandatory: older workers must be upgraded before candidate pruning. */
export function isPackageTextCandidate(
	header: NonNullable<ProjectIndexHeader["headerData"]>,
	hasExternalPackages = false
): boolean {
	return (
		(header.packageFlags & REQUIRES_LOCALIZATION_GATHER) !== 0 ||
		(header.gatherableTextDataCount > 0 && header.gatherableTextDataOffset > 0) ||
		hasExternalPackages
	);
}

/** Complete covers inspected candidates. Exclusion never proves the absence of FText. */
export function textCorpusWithExcludedPackages(
	corpus: TextCorpus,
	packageFiles: readonly string[]
): TextCorpus {
	return runHostStepsSync(
		textCorpusWithExcludedPackagesSteps(corpus, packageFiles, new HostSliceClock(Infinity))
	);
}

/** Host steps for `textCorpusWithExcludedPackages`, for inventories of many excluded packages. */
export function* textCorpusWithExcludedPackagesSteps(
	corpus: TextCorpus,
	packageFiles: readonly string[],
	clock: HostSliceClock
): HostSteps<TextCorpus> {
	const excluded = new Set<string>();
	for (const packageFile of packageFiles) {
		excluded.add(packageFile);
		if (clock.step()) yield;
	}
	for (const unit of corpus.units) {
		if (unit.occurrences.some((occurrence) => excluded.has(occurrence.packageFile)))
			throw new Error("STOP: excluded package contains decoded text.");
		if (clock.step()) yield;
	}
	const coverage = corpus.packageCoverage ?? [];
	if (coverage.some((item) => excluded.has(item.packageFile)))
		throw new Error("An excluded package must not also be inspected.");
	const packageCoverage: TextPackageCoverage[] = [...coverage];
	const diagnostics: TextCorpusDiagnostic[] = [...corpus.diagnostics];
	for (const packageFile of excluded) {
		packageCoverage.push({ packageFile, status: "not_gatherable" });
		if (clock.step()) yield;
	}
	for (const packageFile of excluded) {
		diagnostics.push({
			code: "package_not_gatherable",
			packageFile,
			message:
				"Excluded because Unreal does not gather this package. Its text payload was not inspected."
		});
		if (clock.step()) yield;
	}
	return { ...corpus, packageCoverage, diagnostics };
}
