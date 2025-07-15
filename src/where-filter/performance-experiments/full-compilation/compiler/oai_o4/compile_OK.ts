// build-precompiled.ts
import path from "path";
import { Project, TypeFormatFlags } from "ts-morph";

async function main() {
  // 1. Create a project, but only add the three files you care about
  const project = new Project({
    tsConfigFilePath: "tsconfig.json",
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths([
    "wherefilter.ts",
    "user.ts",
    "filters-auto.ts",
  ]);

  // 2. Grab the filters-auto.ts and its UserFilter alias
  const sf = project.getSourceFileOrThrow("filters-auto.ts");
  const alias = sf.getTypeAliasOrThrow("UserFilter");

  // 3. Fully inline it:
  const inlined = alias.getType().getText(
    alias,
    // • NoTruncation: don’t use “…”  
    // • WriteArrayAsGenericType: print arrays as Array<T>  
    // • NoTypeReduction: don’t collapse unions/intersections  
    // • InTypeAlias: treat this as “inside” a type alias so it expands all aliases :contentReference[oaicite:0]{index=0}
    TypeFormatFlags.NoTruncation |
    TypeFormatFlags.WriteArrayAsGenericType |
    TypeFormatFlags.NoTypeReduction |
    TypeFormatFlags.InTypeAlias
  );

  // 4. Emit filters-precompiled.ts beside filters-auto.ts
  const outPath = path.join(sf.getDirectoryPath(), "filters-precompiled.ts");
  project.createSourceFile(
    outPath,
    `// filters-precompiled.ts
export type UserFilter = ${inlined};
`,
    { overwrite: true }
  );

  // 5. Save to disk
  await project.save();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
