// THIS HAS NOT BEEN COPIED INTO A compile_XXXX.ts FILE. DO THAT BEFORE EDITING.

import { Project, TypeFormatFlags, Type, Node } from 'ts-morph';
import * as path from 'path';

// Kinda works if you add type WhereFilterDefinition<T> = Partial<T>; to the top as a bail out. 
// Maybe: type WhereFilterDefinition<T> = Partial<T> | { AND?: WhereFilterDefinition<T>[]; OR?: WhereFilterDefinition<T>[]; NOT?: WhereFilterDefinition<T>[]; };; // I manu
// Still fails for nested elem_match, which works in practice

// --- Helper Function for Custom Type Simplification ---

const MAX_DEPTH = 5; // Set the recursion limit as requested.

/**
 * Recursively generates a type's text, applying custom rules to simplify
 * `WhereFilterDefinition<T>` and other aliases, with a depth guard to prevent infinite loops.
 * @param type The type to process.
 * @param location The node providing context for type resolution.
 * @param flags The formatting flags to use.
 * @param depth The current recursion depth.
 * @returns A string representation of the simplified type.
 */
function getSimplifiedTypeText(type: Type, location: Node, flags: TypeFormatFlags, depth: number): string {
    // BASE CASE: If we exceed the max depth, stop recursing and just print the type.
    if (depth >= MAX_DEPTH) {
        return type.getText(location, flags);
    }

    // RULE 1: If the type is an alias for `WhereFilterDefinition`, expand its inner type.
    const aliasSymbol = type.getAliasSymbol();
    if (aliasSymbol?.getName() === 'WhereFilterDefinition') {
        // `getApparentType()` resolves the alias to its underlying structure (the union).
        // Then we recurse on that structure with an increased depth.
        return getSimplifiedTypeText(type.getApparentType(), location, flags, depth + 1);
    }

    // RULE 2: If the type is a union, recursively process each member.
    if (type.isUnion()) {
        return type.getUnionTypes().map(t => getSimplifiedTypeText(t, location, flags, depth + 1)).join(' | ');
    }

    // RULE 3: If the type is an object, handle its different forms.
    if (type.isObject() && !type.isArray()) {
        const properties = type.getProperties();

        // Case 3a: Logic Filter `{ AND, OR, NOT }`.
        const isLogicFilter = properties.some(p => ["AND", "OR", "NOT"].includes(p.getName()));
        if (isLogicFilter) {
            const propStrings = properties.map(prop => {
                const propType = prop.getTypeAtLocation(location);
                const arrayElementType = propType.getArrayElementType();
                if (arrayElementType) {
                    // Recurse into the type inside the array (e.g., the T in WhereFilterDefinition<T>[]).
                    const simplifiedArrayType = getSimplifiedTypeText(arrayElementType, location, flags, depth + 1);
                    return `${prop.getName()}?: ${simplifiedArrayType}[]`;
                }
                return `${prop.getName()}?: any[]`; // Fallback
            });
            return `{ ${propStrings.join('; ')} }`;
        }
        
        // Case 3b: Elem Match Filter `{ elem_match: ... }`.
        const elemMatchProp = properties.find(p => p.getName() === 'elem_match');
        if (properties.length === 1 && elemMatchProp) {
            const elemMatchType = elemMatchProp.getTypeAtLocation(location);
            // Recurse into the type of the `elem_match` property.
            const simplifiedElemMatchType = getSimplifiedTypeText(elemMatchType, location, flags, depth + 1);
            return `{ elem_match: ${simplifiedElemMatchType}; }`;
        }

        // Case 3c: For other objects, just expand their properties.
        // This correctly handles plain objects and the contents of a `Partial<T>`.
        const propStrings = properties.map(prop => {
            const propType = prop.getTypeAtLocation(location);
            const simplifiedPropType = getSimplifiedTypeText(propType, location, flags, depth + 1);
            const optionalMarker = prop.isOptional() ? '?' : '';
            return `"${prop.getName()}"${optionalMarker}: ${simplifiedPropType}`;
        });

        return `{ ${propStrings.join('; ')} }`;
    }

    // FALLBACK: For any other type (primitives, arrays, etc.), use the default getText().
    return type.getText(location, flags);
}

// --- Main Type Flattening Script ---

async function flattenUserFilterType() {
  const project = new Project();
  project.addSourceFilesAtPaths([
    path.join(__dirname, 'wherefilter.ts'),
    path.join(__dirname, 'user.ts'),
    path.join(__dirname, 'filters-auto.ts'),
  ]);

  const filtersAutoFile = project.getSourceFileOrThrow('filters-auto.ts');
  const userFilterTypeAlias = filtersAutoFile.getTypeAliasOrThrow('UserFilter');
  const userFilterType = userFilterTypeAlias.getType();

  if (!userFilterType.isUnion()) {
    console.error(`Error: Expected UserFilter to be a union type.`);
    return;
  }
  const unionTypes = userFilterType.getUnionTypes();
  const partialObjectFilterType = unionTypes.find(t => t.getProperty('AND') == null);
  
  if (!partialObjectFilterType) {
    console.error('Error: Could not resolve the PartialObjectFilter part of the union.');
    return;
  }

  const properties = partialObjectFilterType.getProperties();
  const propertyStrings = [];

  const formattingFlags = TypeFormatFlags.NoTruncation | 
                          TypeFormatFlags.UseFullyQualifiedType |
                          TypeFormatFlags.NoTypeReduction;

  for (const propSymbol of properties) {
    const propName = propSymbol.getName();
    const propType = propSymbol.getTypeAtLocation(userFilterTypeAlias);

    // Use our recursive function, starting at depth 0.
    const propTypeText = getSimplifiedTypeText(propType, userFilterTypeAlias, formattingFlags, 0);

    propertyStrings.push(`"${propName}"?: ${propTypeText}`);
  }

  propertyStrings.sort();

  const partialObjectFilterText = `Partial<{\n  ${propertyStrings.join(';\n  ')}\n}>`;
  const logicFilterText = `{ AND?: UserFilter[]; OR?: UserFilter[]; NOT?: UserFilter[]; }`;
  const finalTypeText = `${partialObjectFilterText} | ${logicFilterText}`;
  
  const precompiledFileContent = `// This file is auto-generated. Do not edit manually.\n\nexport type UserFilter = ${finalTypeText};`;

  project.createSourceFile(
    path.join(__dirname, 'filters-precompiled.ts'),
    precompiledFileContent,
    { overwrite: true }
  ).saveSync();
  
  console.log('Successfully generated filters-precompiled.ts with a recursion depth limit.');
}

flattenUserFilterType().catch(error => {
  console.error('An error occurred during type flattening:', error);
});