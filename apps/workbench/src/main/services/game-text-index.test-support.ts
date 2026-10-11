import { Effect, Layer, Option } from "effect";
import {
	GameTextIndexRefresh,
	GameTextIndexError,
	TextCorpusService,
	joinLocalizationTarget,
	applyLocalizationReview,
	applyLocalizationKeyChanges,
	localizationKeyChanges,
	mergeLocalizationKeyChanges,
	textCorpusQuery,
	type GameTextIndexRefreshResult,
	type TextCorpus
} from "@ue-shed/game-text";
import {
	LocalizationEvidence,
	LocalizationFileAccessLive,
	readLocalizationReview,
	emptyLocalizationReviewFile,
	defaultLocalizationReviewPath
} from "@ue-shed/localization";
import { WorkbenchProject } from "./project-workspace.js";

/** The event-built implementation stays in host tests as the behavioral oracle. */
export function oracleGameTextIndexLayer<E>(read: (root: string) => Effect.Effect<TextCorpus, E>) {
	return Layer.effect(
		GameTextIndexRefresh,
		Effect.gen(function* () {
			const evidence = yield* LocalizationEvidence;
			let retained: TextCorpus | undefined;
			return GameTextIndexRefresh.of({
				invalidate: () => Effect.void,
				refresh: Effect.fn("Test.GameTextIndex.refresh")(function* (request) {
					const corpus =
						request.targetName === undefined || !retained
							? yield* read(request.projectRoot).pipe(
									Effect.mapError(
										(cause) =>
											new GameTextIndexError({
												operation: "scan",
												retrySafe:
													cause instanceof Object && "retrySafe" in cause
														? Boolean(cause.retrySafe)
														: true,
												message:
													cause instanceof Error
														? cause.message
														: String(cause),
												recovery:
													cause instanceof Object && "recovery" in cause
														? String(cause.recovery)
														: "Retry the test scan."
											})
									)
								)
							: retained;
					retained = corpus;
					const target =
						request.targetName === undefined
							? undefined
							: (yield* evidence.discover({ projectRoot: request.projectRoot }).pipe(
									Effect.mapError(
										(cause) =>
											new GameTextIndexError({
												operation: cause.code,
												message: cause.message,
												recovery: cause.recovery
											})
									)
								)).targets.find((target) => target.name === request.targetName);
					const files = target
						? yield* evidence.read({ projectRoot: request.projectRoot, target }).pipe(
								Effect.mapError(
									(cause) =>
										new GameTextIndexError({
											operation: cause.code,
											message: cause.message,
											recovery: cause.recovery
										})
								)
							)
						: undefined;
					const review = target
						? Option.getOrUndefined(
								yield* readLocalizationReview({
									projectRoot: request.projectRoot,
									target: target.name
								}).pipe(Effect.provide(LocalizationFileAccessLive), Effect.option)
							)
						: undefined;
					const joined = files
						? applyLocalizationReview(
								joinLocalizationTarget(corpus, files),
								review?.contentHash ? review.file : undefined
							)
						: undefined;
					const join = joined
						? applyLocalizationKeyChanges(
								joined,
								mergeLocalizationKeyChanges(
									localizationKeyChanges(joined, corpus).pairs,
									request.keyChangePairs ?? []
								)
							)
						: undefined;
					const query = textCorpusQuery(corpus, undefined, join);
					return {
						corpus,
						query,
						get localizationJoin(): GameTextIndexRefreshResult["localizationJoin"] {
							if (!join) throw new Error("No target in this oracle request");
							return join;
						},
						get evidence(): GameTextIndexRefreshResult["evidence"] {
							if (!files) throw new Error("No target in this oracle request");
							return files;
						},
						get review(): GameTextIndexRefreshResult["review"] {
							if (!target) throw new Error("No target in this oracle request");
							return (
								review ?? {
									file: emptyLocalizationReviewFile(target.name),
									contentHash: null,
									relativePath: defaultLocalizationReviewPath(target.name)
								}
							);
						},
						get joined(): GameTextIndexRefreshResult["joined"] {
							throw new Error("Host must query through the service API");
						},
						get imported(): GameTextIndexRefreshResult["imported"] {
							throw new Error("Unused builder evidence in host oracle");
						},
						get packages(): GameTextIndexRefreshResult["packages"] {
							throw new Error("Unused builder evidence in host oracle");
						},
						get join(): GameTextIndexRefreshResult["join"] {
							throw new Error("Unused builder evidence in host oracle");
						}
					};
				})
			});
		})
	);
}

export const workbenchGameTextIndexOracleLayer = Layer.unwrap(
	Effect.gen(function* () {
		const scanner = yield* TextCorpusService;
		const project = yield* WorkbenchProject;
		return oracleGameTextIndexLayer((root) =>
			project
				.candidates("game_text")
				.pipe(
					Effect.flatMap((index) =>
						scanner.scanFromProjectIndex(index, { projectRoot: root })
					)
				)
		);
	})
);

import { makeGameTextLocalization as indexedGameTextLocalization } from "./game-text-localization.js";
export const makeGameTextLocalizationOracle = (
	...args: Parameters<typeof indexedGameTextLocalization>
) =>
	indexedGameTextLocalization(...args).pipe(
		Effect.provide(
			oracleGameTextIndexLayer(() =>
				args[0]().pipe(
					Effect.map((corpus) => {
						if (!corpus) throw new Error("No corpus in this oracle request");
						return corpus;
					})
				)
			)
		),
		Effect.scoped
	);
