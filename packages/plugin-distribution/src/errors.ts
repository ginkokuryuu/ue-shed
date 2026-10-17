import { Schema } from "effect";

const ErrorFields = {
	message: Schema.String,
	recovery: Schema.String,
	retrySafe: Schema.Boolean
};

/** The original failure behind a classified error; diagnostic evidence, not text to branch on. */
const CauseFields = { cause: Schema.optionalKey(Schema.Defect()) };

export class ReleaseUnavailable extends Schema.TaggedError<ReleaseUnavailable>()(
	"ReleaseUnavailable",
	{ ...ErrorFields, releaseVersion: Schema.String, ...CauseFields }
) {}

export class OfflineCacheMiss extends Schema.TaggedError<OfflineCacheMiss>()("OfflineCacheMiss", {
	...ErrorFields,
	releaseVersion: Schema.String
}) {}

export class UnsupportedManifestVersion extends Schema.TaggedError<UnsupportedManifestVersion>()(
	"UnsupportedManifestVersion",
	{ ...ErrorFields, releaseVersion: Schema.String }
) {}

export class IncompatibleUnrealVersion extends Schema.TaggedError<IncompatibleUnrealVersion>()(
	"IncompatibleUnrealVersion",
	{ ...ErrorFields, releaseVersion: Schema.String, unrealVersion: Schema.String }
) {}

export class CompatiblePluginBuildUnavailable extends Schema.TaggedError<CompatiblePluginBuildUnavailable>()(
	"CompatiblePluginBuildUnavailable",
	{
		...ErrorFields,
		architecture: Schema.String,
		configuration: Schema.String,
		engineBuildId: Schema.String,
		platform: Schema.String,
		releaseVersion: Schema.String,
		target: Schema.String,
		unrealVersion: Schema.String
	}
) {}

export class ManifestDigestMismatch extends Schema.TaggedError<ManifestDigestMismatch>()(
	"ManifestDigestMismatch",
	{
		...ErrorFields,
		actual: Schema.String,
		expected: Schema.String,
		releaseVersion: Schema.String
	}
) {}

export class ArtifactDigestMismatch extends Schema.TaggedError<ArtifactDigestMismatch>()(
	"ArtifactDigestMismatch",
	{
		...ErrorFields,
		actual: Schema.String,
		expected: Schema.String,
		releaseVersion: Schema.String
	}
) {}

export class MalformedOrUnsafeArchive extends Schema.TaggedError<MalformedOrUnsafeArchive>()(
	"MalformedOrUnsafeArchive",
	{ ...ErrorFields, entry: Schema.optional(Schema.String), releaseVersion: Schema.String }
) {}

export class CorruptCacheEntry extends Schema.TaggedError<CorruptCacheEntry>()(
	"CorruptCacheEntry",
	{ ...ErrorFields, cachePath: Schema.String, releaseVersion: Schema.String, ...CauseFields }
) {}

export class ImmutableVersionConflict extends Schema.TaggedError<ImmutableVersionConflict>()(
	"ImmutableVersionConflict",
	{ ...ErrorFields, cachePath: Schema.String, releaseVersion: Schema.String }
) {}

export class PluginInstallCancelled extends Schema.TaggedError<PluginInstallCancelled>()(
	"PluginInstallCancelled",
	{ ...ErrorFields, releaseVersion: Schema.String, stage: Schema.String }
) {}

export class ActiveLeasePreventsPrune extends Schema.TaggedError<ActiveLeasePreventsPrune>()(
	"ActiveLeasePreventsPrune",
	{ ...ErrorFields, activeLeases: Schema.Int, releaseVersion: Schema.String }
) {}

export class TransportFailure extends Schema.TaggedError<TransportFailure>()("TransportFailure", {
	...ErrorFields,
	operation: Schema.String,
	releaseVersion: Schema.String,
	...CauseFields
}) {}

export class PluginStorageFailure extends Schema.TaggedError<PluginStorageFailure>()(
	"PluginStorageFailure",
	{ ...ErrorFields, operation: Schema.String, releaseVersion: Schema.String, ...CauseFields }
) {}

export class PluginDistributionValidationError extends Schema.TaggedError<PluginDistributionValidationError>()(
	"PluginDistributionValidationError",
	{ ...ErrorFields, field: Schema.String, ...CauseFields }
) {}

export class InternalInvariantFailure extends Schema.TaggedError<InternalInvariantFailure>()(
	"InternalInvariantFailure",
	{ ...ErrorFields, operation: Schema.String }
) {}

export const PluginDistributionError = Schema.Union([
	ReleaseUnavailable,
	OfflineCacheMiss,
	UnsupportedManifestVersion,
	IncompatibleUnrealVersion,
	CompatiblePluginBuildUnavailable,
	ManifestDigestMismatch,
	ArtifactDigestMismatch,
	MalformedOrUnsafeArchive,
	CorruptCacheEntry,
	ImmutableVersionConflict,
	PluginInstallCancelled,
	ActiveLeasePreventsPrune,
	TransportFailure,
	PluginStorageFailure,
	PluginDistributionValidationError,
	InternalInvariantFailure
]);
export type PluginDistributionError = typeof PluginDistributionError.Type;
