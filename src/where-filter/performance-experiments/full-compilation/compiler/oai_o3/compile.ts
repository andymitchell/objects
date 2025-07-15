// scripts/precompile-filters.ts  (run with:  npx ts-node scripts/precompile-filters.ts)
import { Project, ts } from "ts-morph";
import path from "path";

async function main() {
  const project = new Project({
    // use your real tsconfig here so module resolution & compilerOptions match the source
    tsConfigFilePath: path.resolve(__dirname, "./tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });

  // make sure the three source files are definitely in the project
  project.addSourceFilesAtPaths([
    "wherefilter.ts",
    "user.ts",
    "filters-auto.ts",
  ]);

  // 1️⃣ locate the alias we want to flatten
  const autoFile        = project.getSourceFileOrThrow("filters-auto.ts");
  const userFilterAlias = autoFile.getTypeAliasOrThrow("UserFilter");

  // 2️⃣ produce a self‑contained textual representation of the alias’ type
  const FULL_FLAGS =
    ts.TypeFormatFlags.InTypeAlias |
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;

  let flat = userFilterAlias.getType().getText(userFilterAlias, FULL_FLAGS);

  // Optional: strip `import("...").` prefixes that sometimes sneak in
  flat = flat.replace(/import\([^)]+\)\./g, "");

  // 3️⃣ emit ➜ filters‑precompiled.ts
  const out = project.createSourceFile(
    "filters-precompiled.ts",
    `// AUTO‑GENERATED – DO NOT EDIT  
export type UserFilter = ${flat};
`,
    { overwrite: true },
  );

  out.formatText();   // prettify

  await project.save(); // write to disk
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
