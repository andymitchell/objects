import { Project, TypeFormatFlags } from 'ts-morph';
import * as path from 'path';

async function flattenUserFilterType() {
    // Initialize a ts-morph project
    const project = new Project();

    // Add the source files to the project.
    // This allows ts-morph to resolve types across files.
    project.addSourceFilesAtPaths([
        path.join(__dirname, 'wherefilter.ts'),
        path.join(__dirname, 'user.ts'),
        path.join(__dirname, 'filters-auto.ts'),
    ]);

    // Get the source file that contains the UserFilter type alias.
    const filtersAutoFile = project.getSourceFileOrThrow('filters-auto.ts');

    // Get the UserFilter type alias declaration.
    const userFilterTypeAlias = filtersAutoFile.getTypeAliasOrThrow('UserFilter');

    // Get the actual type that UserFilter represents.
    const userFilterType = userFilterTypeAlias.getType();

    // The UserFilter is a union type: PartialObjectFilter<User> | LogicFilter<User>.
    // We are interested in the first part of this union.
    if (userFilterType.isUnion()) {
        const partialObjectFilterType = userFilterType.getUnionTypes()[0];

        // Get the fully resolved and inlined text of the type.
        // The NoTruncation flag ensures we get the full type definition.
        const flattenedTypeText = partialObjectFilterType!.getText(
            userFilterTypeAlias,
            TypeFormatFlags.NoTruncation
        );

        // Create the content for the new file.
        const precompiledFileContent = `export type UserFilter = ${flattenedTypeText};`;

        // Create a new source file with the flattened type.
        const precompiledFile = project.createSourceFile(
            path.join(__dirname, 'filters-precompiled.ts'),
            precompiledFileContent,
            { overwrite: true }
        );

        // Save the new file to disk.
        await precompiledFile.save();

        console.log('Successfully generated filters-precompiled.ts');
    } else {
        console.error(
            'UserFilter was not a union type as expected. Cannot flatten.'
        );
    }
}

// Execute the script
flattenUserFilterType().catch((error) => {
    console.error('An error occurred:', error);
});