// The 0.13 trial tarball imports APIs only available in Effect beta.37.
// pnpm does not apply version-based packageExtensions to this file dependency.
module.exports = {
	hooks: {
		readPackage(pkg) {
			if (pkg.name === "p4client-ts" && pkg.version === "0.13.0") {
				pkg.dependencies = { ...pkg.dependencies, effect: "4.0.0-beta.37" };
				delete pkg.peerDependencies.effect;
			}
			return pkg;
		}
	}
};
