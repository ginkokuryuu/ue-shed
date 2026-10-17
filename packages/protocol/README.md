# `@ue-shed/protocol`

The application must provide `effect@^4.0.0` as a peer dependency. Reuse one compatible
Effect installation across the application and UE Shed libraries.

Runtime schemas, branded identifiers, compatibility values, and versioned wire contracts shared by
UE Shed clients and Unreal companion plugins.

```sh
npm install --save-exact @ue-shed/protocol "effect@^4.0.0"
```

The package supports Node.js 22.14 or newer and exposes one stable JavaScript entry point:

```ts
import {
	CURRENT_PROTOCOL_VERSION,
	CapabilityManifest,
	decodeCapabilityManifest
} from "@ue-shed/protocol";
```

The root entry point includes the core capability and connection schemas plus the authoring, camera,
companion, editor play-session, and editor world-control contracts. Internal source modules are not
public subpaths.

The `contracts/` directory in the package contains the language-neutral JSON Schema authorities and
conformance fixtures. These files are shipped for protocol implementors, but JavaScript consumers
should use the runtime schemas exported from the package root.

The current core protocol version is `0.1`. Individual domain contracts carry their own versions;
consumers must validate untrusted wire input instead of casting it to an exported TypeScript type.

This package does not connect to Unreal Engine, launch processes, or depend on the UE Shed Workbench.

The uasset-io contract adds `game_text_index` at version 1.13. A scoped protocol session owns the
native build lease and accepts typed preparation, dictionary, join and compaction operations.
Older minors reject that operation. Snapshot paths refer to caller-staged files in the paired
private Game Text format; roots and layer records are validated again by the domain adapter.
Intern strings are bounded to 1 MiB each, and join inputs and selected-string output files to
32 MiB. See the [native preparation guide](../../docs/engineering/native-game-text-index.md).

## License

MIT. Unreal Engine is a trademark of Epic Games, Inc. This project is not affiliated with or
endorsed by Epic Games.
