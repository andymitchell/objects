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
            'index-primary-key': 'src/primary-key/index.ts',
            'index-utils': 'src/utils/index.ts',
        },
        publicDir: false,
        clean: true,
        target: ['esnext'],
        minify: false,
        dts: true,
        format: ['esm'], // When this changes, update 'type' in package.json
        external: [
            'zod'
        ],
    },
]);
