import { defineConfig } from "tsup";
 
export default defineConfig({
  entry: {
    'index': "src/index.ts",
    'index-where-filter': 'src/where-filter/index.ts'
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
});