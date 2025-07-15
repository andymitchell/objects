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

  // 1) Fully inline the type
  let inlined = alias.getType().getText(
    alias,
    TypeFormatFlags.NoTruncation |
    TypeFormatFlags.WriteArrayAsGenericType |
    TypeFormatFlags.NoTypeReduction |
    TypeFormatFlags.InTypeAlias
  );

  // 2a) Redirect the logic‐array back to our alias
  inlined = inlined.replace(
    /Array<\s*WhereFilterDefinition<\s*User\s*>\s*>/g,
    "Array<UserFilter>"
  );

  // 2b) Any top‑level WhereFilterDefinition<User> → UserFilter
  inlined = inlined.replace(
    /\bWhereFilterDefinition<\s*User\s*>\b/g,
    "UserFilter"
  );

  // 2c) **New:** unwrap any remaining object‑literal filters
  //      e.g. elem_match: WhereFilterDefinition<{ name: string; }> → elem_match: { name: string; }
  inlined = inlined.replace(
    /WhereFilterDefinition<\s*({[^>]+})\s*>/g,
    "$1"
  );

  // 3) Emit filters-precompiled.ts
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
