---
"@ue-shed/cameras": minor
"@ue-shed/game-text": patch
---

**Breaking:** layers compose through requirements, and test layers are complete fakes.

- `@ue-shed/authoring` (private, no release): `authoringSessionServiceLayer(config)` and `makeAuthoringSessionService(config)` no longer take an id-generator Layer. They require `AuthoringIdGenerator`.
- `@ue-shed/authoring-catalog` (private, no release): `authoringLiveConnectionLayer(connection)` is removed. Provide the connection as the `AuthoringLiveConnection` service.
- `@ue-shed/cameras`: `makeReviewRepositoryTestLayer` and `makeReviewAuthoringTestLayer` take the complete service. They no longer fill `listSets` or `inspectSubject` with a defect.
- `@ue-shed/game-text`: the internal project-view layer requires the `SharedIndex` it wraps instead of taking it as a Layer; `sharedIndexNodeLayer` is unchanged.

Migration:

- Write `authoringSessionServiceLayer(config).pipe(Layer.provide(AuthoringIdGeneratorLive))` and `makeAuthoringSessionService(config).pipe(Effect.provide(AuthoringIdGeneratorLive))`. Tests provide `authoringIdGeneratorLayer(...)` the same way.
- Replace `Effect.provide(authoringLiveConnectionLayer(connection))` with `Effect.provideService(AuthoringLiveConnection, connection)`.
- Callers of the two cameras test layers supply `listSets` and `inspectSubject` themselves.
