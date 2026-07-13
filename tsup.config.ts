import { defineConfig } from "tsup";

export default defineConfig([
    {
        entry: {
            'index': "src/index.ts",
            'index-where-filter': 'src/where-filter/index.ts',
            'index-write-actions': 'src/write-actions/index.ts',
            'index-objects-delta': 'src/objects-delta/index.ts',
            'index-objects-delta-testing': 'src/objects-delta/index-testing.ts',
            'index-query': 'src/query/index.ts',
            'index-dot-prop-paths': 'src/dot-prop-paths/index.ts',
            'index-zod': 'src/zod/index.ts',
            'index-primary-key': 'src/primary-key/index.ts',
            'index-utils': 'src/utils/index.ts',
            'index-ddl': 'src/ddl/index.ts',
        },
        publicDir: false,
        clean: true,
        target: ['esnext'],
        minify: false,
        dts: true,
        format: ['esm'], // When this changes, update 'type' in package.json
        // esbuild's post-resolution, post-tree-shake input graph. `build/assert-no-devdep-leak.mjs`
        // reads it to prove no devDependency reached a published bundle.
        metafile: true,
        // tsup auto-externalises `dependencies` and `peerDependencies`, but BUNDLES every devDependency
        // an entry can reach. The test runner must never be vendored: a second copy of vitest overwrites
        // `globalThis[Symbol.for('expect-global')]` and silently steals the consumer runner's per-test state.
        external: [
            'zod',
            /^vitest(\/|$)/,
            /^@vitest\//,
            'chai',
        ],
    },
]);
