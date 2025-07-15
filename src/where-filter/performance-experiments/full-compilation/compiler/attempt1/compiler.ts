import { Project, ts, Node, Type, TypeAliasDeclaration, SourceFile } from "ts-morph";
import path from "path";

const JSDOC_TAG = "@precompile-filter";

// =================================================================================
// 1. CORE PROCESSING LOGIC (No I/O)
// This function operates on a Project that is already loaded with source files.
// =================================================================================

/**
 * Scans a ts-morph Project for types with the "@precompile-filter" JSDoc tag
 * and generates concrete filter type definitions.
 *
 * @param project A ts-morph Project instance already populated with source files.
 * @returns A promise that resolves to a string containing all generated type definitions.
 */
export async function processProjectForFilters(project: Project): Promise<string> {
    let allGeneratedTypes = `// THIS FILE IS AUTO-GENERATED. DO NOT EDIT.\n\n`;
    const sourceFiles = project.getSourceFiles();

    for (const sourceFile of sourceFiles) {
        const typeAliases = sourceFile.getDescendantsOfKind(ts.SyntaxKind.TypeAliasDeclaration);

        for (const typeAlias of typeAliases) {
            if (hasPrecompileTag(typeAlias)) {
                const originalTypeName = typeAlias.getName();
                console.log(`Processing type "${originalTypeName}" from ${sourceFile.getBaseName() || 'in-memory file'}...`);

                try {
                    // The core generation logic is now cleanly separated
                    const generatedTypeString = await generateFilterTypeString(project, typeAlias);
                    allGeneratedTypes += generatedTypeString + "\n\n";
                } catch (error) {
                    console.error(`Failed to generate filter for type "${originalTypeName}":`, error);
                }
            }
        }
    }
    return allGeneratedTypes;
}


// =================================================================================
// 2. IN-MEMORY ENTRY POINT
// Use this for testing or programmatic generation without touching the filesystem.
// =================================================================================

/**
 * Generates filter types from strings of TypeScript source code.
 *
 * @param modelSourceCode A string containing the TypeScript type definitions (e.g., your Person type).
 * @param helpersSourceCode A string containing all the necessary helper types (e.g., WhereFilterDefinition).
 * @returns A promise that resolves to a string containing the generated filter types.
 */
export async function generateFiltersFromSource(
    modelSourceCode: { path: string, content: string },
    helperDependencies: Map<string, string>
): Promise<string> {
    console.log("Running filter generation in-memory...");
    const project = new Project({ useInMemoryFileSystem: true });

    // Create all the necessary helper files in the virtual filesystem
    for (const [filePath, fileContent] of helperDependencies.entries()) {
        project.createSourceFile(filePath, fileContent);
    }
    
    // Add the main data model file that uses the helpers
    project.createSourceFile(modelSourceCode.path, modelSourceCode.content);

    // Run the core processing logic on the fully-formed in-memory project
    return processProjectForFilters(project);
}



/**
 * Traverses the import graph of a given entry point file and returns a map
 * of all dependent source files and their content. This is used to construct
 * an in-memory representation of the required helper modules.
 *
 * @param entrypointPath The absolute path to the main helper file (e.g., 'src/filter-helpers.ts').
 * @returns A promise that resolves to a Map<string, string> where keys are file paths
 *          and values are the source code of those files.
 */
export async function getDependencyMapForEntrypoint(entrypointPath: string): Promise<Map<string, string>> {
    const project = new Project({ tsConfigFilePath: "tsconfig.json" });
    const entrypointFile = project.getSourceFileOrThrow(entrypointPath);
    
    const dependencyMap = new Map<string, string>();
    const filesToProcess: SourceFile[] = [entrypointFile];
    const processedFiles = new Set<string>();

    while (filesToProcess.length > 0) {
        const currentFile = filesToProcess.pop()!;
        const currentPath = currentFile.getFilePath();

        if (processedFiles.has(currentPath)) {
            continue;
        }

        dependencyMap.set(currentPath, currentFile.getFullText());
        processedFiles.add(currentPath);

        const imports = currentFile.getImportDeclarations();
        for (const imp of imports) {
            const importedFile = imp.getModuleSpecifierSourceFile();
            if (importedFile) {
                filesToProcess.push(importedFile);
            }
        }
    }

    return dependencyMap;
}

function hasPrecompileTag(node: TypeAliasDeclaration): boolean {
    return node.getJsDocs().some(doc => doc.getFullText().includes(JSDOC_TAG));
}

async function generateFilterTypeString(project: Project, originalTypeAlias: TypeAliasDeclaration): Promise<string> {
    const originalTypeName = originalTypeAlias.getName();

    // We get the path from the node itself, which works for both real and virtual files
    const originalFilePath = originalTypeAlias.getSourceFile().getFilePath();

    // The temporary file logic now works seamlessly with in-memory files
    const tempResolverFile = project.createSourceFile(
        `__temp_resolver_${originalTypeName}.ts`,
        `
        import type { WhereFilterDefinition } from './filter-helpers';
        import type { ${originalTypeName} } from '${originalFilePath.replace('.ts', '')}';
        
        export type Generated = WhereFilterDefinition<${originalTypeName}>;
        `
    );

    const resolvedType = tempResolverFile.getTypeAliasOrThrow("Generated").getType();
    const properties = resolvedType.getProperties();

    let newTypeString = `export type ${originalTypeName}Filter = {`;
    if (properties.length > 0) {
        newTypeString += `\n`;
        for (const prop of properties) {
            const propName = prop.getName();
            const propType = prop.getValueDeclarationOrThrow().getType();
            const propTypeText = propType.getText(tempResolverFile);
            newTypeString += `    '${propName}'?: ${propTypeText};\n`;
        }
    }
    newTypeString += `};`;

    project.removeSourceFile(tempResolverFile);
    return newTypeString;
}