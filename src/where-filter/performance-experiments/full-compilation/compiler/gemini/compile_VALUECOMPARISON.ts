// Not the end of the world: ValueComparison won't slow it too much. 

import { Project, Type, TypeFormatFlags } from 'ts-morph';
import * as path from 'path';

async function flattenUserFilterType() {
  // 1. Initialize the project and add all relevant source files.
  const project = new Project();
  project.addSourceFilesAtPaths([
    path.join(__dirname, 'wherefilter.ts'),
    path.join(__dirname, 'user.ts'),
    path.join(__dirname, 'filters-auto.ts'),
  ]);

  // 2. Get the target type alias from the source file.
  const filtersAutoFile = project.getSourceFileOrThrow('filters-auto.ts');
  const userFilterTypeAlias = filtersAutoFile.getTypeAliasOrThrow('UserFilter');
  const userFilterType = userFilterTypeAlias.getType();

  // 3. Confirm it's a union and get its constituent types.
  if (!userFilterType.isUnion()) {
    console.error('Error: UserFilter is not a union type as expected.');
    return;
  }
  const unionTypes = userFilterType.getUnionTypes();

  // 4. Isolate the `PartialObjectFilter<User>` part of the union.
  // We identify it as the part that does *not* have the 'AND' logical property.
  const partialObjectFilterType = unionTypes.find(t => t.getProperty('AND') == null);
  
  if (!partialObjectFilterType) {
      console.error('Error: Could not resolve the PartialObjectFilter part of the union.');
      return;
  }

  // 5. Get the fully expanded text of the flattened object part.
  // CORRECTED: Pass `undefined` instead of `null`, and remove the non-existent flag.
  const partialObjectFilterText = partialObjectFilterType.getText(
    undefined, 
    TypeFormatFlags.NoTruncation
  );

  // 6. Manually construct the recursive logic filter string. This is the most reliable
  // way to handle the self-referencing part and avoid the `UserFilter = UserFilter` issue.
  const logicFilterText = `{ AND?: UserFilter[]; OR?: UserFilter[]; NOT?: UserFilter[]; }`;

  // 7. Combine the flattened object part and the logic part into the final type definition.
  const finalTypeText = `${partialObjectFilterText} | ${logicFilterText}`;

  const precompiledFileContent = `// This file is auto-generated. Do not edit manually.\n\nexport type UserFilter = ${finalTypeText};`;

  // 8. Create the new source file, using the built-in formatter for clean output.
  const precompiledFile = project.createSourceFile(
    path.join(__dirname, 'filters-precompiled.ts'),
    precompiledFileContent,
    { overwrite: true }
  );

  precompiledFile.formatText({
      indentSize: 2,
      convertTabsToSpaces: true,
  });

  // 9. Save the formatted file to disk.
  await precompiledFile.save();
  console.log('Successfully generated filters-precompiled.ts');
}

// Run the script and handle any errors.
flattenUserFilterType().catch(error => {
  console.error('An error occurred during type flattening:', error);
});