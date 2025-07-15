import { Project, TypeFormatFlags } from 'ts-morph';
import * as path from 'path';

async function flattenUserFilterType() {
  // 1. Initialize the project and add all source files.
  const project = new Project();
  project.addSourceFilesAtPaths([
    path.join(__dirname, 'wherefilter.ts'),
    path.join(__dirname, 'user.ts'),
    path.join(__dirname, 'filters-auto.ts'),
  ]);

  // 2. Get the type alias we want to flatten.
  const filtersAutoFile = project.getSourceFileOrThrow('filters-auto.ts');
  const userFilterTypeAlias = filtersAutoFile.getTypeAliasOrThrow('UserFilter');

  // 3. Get the fully resolved semantic type from the alias.
  const userFilterType = userFilterTypeAlias.getType();

  // 4. The resolved type should be a union. Find the two main parts.
  if (!userFilterType.isUnion()) {
    console.error(`Error: Expected UserFilter to be a union type, but it resolved to '${userFilterType.getText()}'.`);
    return;
  }
  const unionTypes = userFilterType.getUnionTypes();
  const partialObjectFilterType = unionTypes.find(t => t.getProperty('AND') == null);

  if (!partialObjectFilterType) {
    console.error('Error: Could not resolve the PartialObjectFilter part of the union.');
    return;
  }

  // 5. --- Manual Property Building Strategy ---
  // Get all properties from the flattened object type.
  const properties = partialObjectFilterType.getProperties();
  const propertyStrings = [];

  // Define a more aggressive set of formatting flags to encourage inlining.
  const formattingFlags = TypeFormatFlags.NoTruncation |
                          TypeFormatFlags.UseFullyQualifiedType |
                          TypeFormatFlags.NoTypeReduction; // Use NoTypeReduction instead of InLineImports

  for (const propSymbol of properties) {
    const propName = propSymbol.getName();

    // Get the type of the property at the location of our target alias.
    const propType = propSymbol.getTypeAtLocation(userFilterTypeAlias);

    // Get the text of this resolved property type, forcing full expansion.
    const propTypeText = propType.getText(userFilterTypeAlias, formattingFlags);

    // The properties from PartialObjectFilter are optional. Enclose name in quotes for dot-notation.
    propertyStrings.push(`"${propName}"?: ${propTypeText}`);
  }

  // Sort properties alphabetically for a consistent and clean output.
  propertyStrings.sort();

  const partialObjectFilterText = `Partial<{\n  ${propertyStrings.join(';\n  ')};\n}>`;

  // 6. Manually construct the recursive logic filter part.
  const logicFilterText = `{ AND?: UserFilter[]; OR?: UserFilter[]; NOT?: UserFilter[]; }`;

  // 7. Combine the two parts into the final type definition.
  const finalTypeDefinition = `${partialObjectFilterText} | ${logicFilterText}`;

  const precompiledFileContent = `// This file is auto-generated. Do not edit manually.\n\nexport type UserFilter = ${finalTypeDefinition};`;

  // 8. Create and save the new file.
  const precompiledFile = project.createSourceFile(
    path.join(__dirname, 'filters-precompiled.ts'),
    precompiledFileContent,
    { overwrite: true }
  );

  await precompiledFile.save();
  console.log('Successfully generated filters-precompiled.ts with full property inlining.');
}

// Run the script.
flattenUserFilterType().catch(error => {
  console.error('An error occurred during type flattening:', error);
});