// build-precompiled.ts
import path from "path";
import { Project, TypeFormatFlags } from "ts-morph";

async function main() {
  const project = new Project({
    tsConfigFilePath: "tsconfig.json",
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths([
    "wherefilter.ts",
    "user.ts",
    "filters-auto.ts",
  ]);

  const sf = project.getSourceFileOrThrow("filters-auto.ts");
  const alias = sf.getTypeAliasOrThrow("UserFilter");

  // 1) Get the fully inlined text
  let inlined = alias.getType().getText(
    alias,
    TypeFormatFlags.NoTruncation |
    TypeFormatFlags.WriteArrayAsGenericType |
    TypeFormatFlags.NoTypeReduction |
    TypeFormatFlags.InTypeAlias
  );

  // 2) Replace recursive occurrences of the helper with the alias name
  inlined = inlined.replace(
    /\bWhereFilterDefinition<\s*User\s*>\b/g,
    "UserFilter"
  );

  // 3) Emit the precompiled file
  const outPath = path.join(sf.getDirectoryPath(), "filters-precompiled.ts");
  project.createSourceFile(
    outPath,
    `// filters-precompiled.ts
export type UserFilter = ${inlined};
`,
    { overwrite: true }
  );

  await project.save();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
