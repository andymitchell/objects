import { Project, TypeFormatFlags, Type, Node } from 'ts-morph';
import * as path from 'path';

// --- Helper Function for Custom Type Simplification ---

/**
 * Recursively generates a type's text, applying a custom rule to simplify
 * `WhereFilterDefinition<T>` down to just `T`.
 * @param type The type to process.
 * @param location The node providing context for type resolution.
 * @param flags The formatting flags to use.
 * @returns A string representation of the simplified type.
 */
function getSimplifiedTypeText(type: Type, location: Node, flags: TypeFormatFlags): string {
  // Custom Rule: If the type is an alias for `WhereFilterDefinition<T>`,
  // replace the entire type with the text of its first type argument, `T`.
  const aliasSymbol = type.getAliasSymbol();
  if (aliasSymbol?.getName() === 'WhereFilterDefinition' && type.getAliasTypeArguments().length > 0) {
    const innerType = type.getAliasTypeArguments()[0];
    // We get the text of the inner type `T`.
    return innerType!.getText(location, flags);
  }

  // If the type is a union, recursively process each member of the union.
  if (type.isUnion()) {
    return type.getUnionTypes().map(t => getSimplifiedTypeText(t, location, flags)).join(' | ');
  }

  // If the type is an object, check if it's the `{ elem_match: ... }` structure.
  if (type.isObject() && !type.isArray()) {
    const properties = type.getProperties();
    // Check for the specific shape of the `elem_match` object.
    if (properties.length === 1 && properties[0]!.getName() === 'elem_match') {
      const elemMatchProp = properties[0];
      const elemMatchType = elemMatchProp!.getTypeAtLocation(location);
      // Recursively call this function on the type of the `elem_match` property.
      const simplifiedElemMatchType = getSimplifiedTypeText(elemMatchType, location, flags);
      return `{ elem_match: ${simplifiedElemMatchType}; }`;
    }
  }

  // Fallback: For any other type (primitives, arrays, regular objects),
  // use the default getText() method.
  return type.getText(location, flags);
}


// --- Main Type Flattening Script ---

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

  // 5. --- Property Building with Custom Simplification ---
  const properties = partialObjectFilterType.getProperties();
  const propertyStrings = [];

  const formattingFlags = TypeFormatFlags.NoTruncation | 
                          TypeFormatFlags.UseFullyQualifiedType | 
                          TypeFormatFlags.NoTypeReduction;

  for (const propSymbol of properties) {
    const propName = propSymbol.getName();
    const propType = propSymbol.getTypeAtLocation(userFilterTypeAlias);

    // Use our custom function to generate the simplified type text.
    const propTypeText = getSimplifiedTypeText(propType, userFilterTypeAlias, formattingFlags);

    propertyStrings.push(`"${propName}"?: ${propTypeText}`);
  }

  // Sort properties alphabetically for a consistent and clean output.
  propertyStrings.sort();

  const partialObjectFilterText = `Partial<{\n  ${propertyStrings.join(';\n  ')}\n}>`;
  
  // 6. Manually construct the recursive logic filter part.
  const logicFilterText = `{ AND?: UserFilter[]; OR?: UserFilter[]; NOT?: UserFilter[]; }`;
  
  // 7. Combine the two parts into the final type definition.
  const finalTypeText = `${partialObjectFilterText} | ${logicFilterText}`;
  
  const precompiledFileContent = `// This file is auto-generated. Do not edit manually.\n\nexport type UserFilter = ${finalTypeText};`;

  // 8. Create and save the new file.
  const precompiledFile = project.createSourceFile(
    path.join(__dirname, 'filters-precompiled.ts'),
    precompiledFileContent,
    { overwrite: true }
  );
  
  await precompiledFile.save();
  console.log('Successfully generated filters-precompiled.ts with full property inlining and simplification.');
}

// Run the script.
flattenUserFilterType().catch(error => {
  console.error('An error occurred during type flattening:', error);
});