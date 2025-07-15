import { JSDoc, Project, SourceFile, SyntaxKind, TypeAliasDeclaration } from 'ts-morph';
import * as path from 'path';

export interface CompilerOptions {
    project: Project;
    outputFilePath: string;
}

export class WhereFilterCompiler {
    private readonly project: Project;
    private readonly outputFilePath: string;

    constructor(options: CompilerOptions) {
        this.project = options.project;
        this.outputFilePath = options.outputFilePath;
    }

    public async compile() {
        const taggedTypeAliases = this.findTaggedTypeAliases();
        if (taggedTypeAliases.length === 0) {
            console.log('No types with a "@precompile-filter" tag found.');
            return;
        }

        // A temporary file is the perfect canvas for the compiler.
        const tempSourceFile = this.project.createSourceFile(
            '__temp_filter_types__.ts',
            '',
            { overwrite: true }
        );

        // Import WhereFilterDefinition to make it available in the temp file.
        const declarationFile = this.project.getSourceFileOrThrow(
            (sf) => sf.getFilePath().endsWith('index-where-filter-type.d.ts')
        );
        tempSourceFile.addImportDeclaration({
            moduleSpecifier: tempSourceFile.getRelativePathAsModuleSpecifierTo(declarationFile),
            isTypeOnly: true,
            namedImports: ['WhereFilterDefinition'],
        });

        for (const typeAlias of taggedTypeAliases) {
            const originalTypeName = typeAlias.getName();
            const filterTypeName = `${originalTypeName}Filter`;

            const originalTypeSourceFile = typeAlias.getSourceFile();
            // Import the source type (e.g., `User`) into the temp file.
            tempSourceFile.addImportDeclaration({
                moduleSpecifier: tempSourceFile.getRelativePathAsModuleSpecifierTo(originalTypeSourceFile),
                namedImports: [originalTypeName],
            });

            // Create the alias we want the compiler to resolve: `export type UserFilter = WhereFilterDefinition<User>;`
            tempSourceFile.addTypeAlias({
                name: filterTypeName,
                isExported: true,
                type: `WhereFilterDefinition<${originalTypeName}>`,
            });
        }

        // --- NEW STRATEGY: Use the Declaration Emitter ---

        // 1. Configure the project to emit declaration files.
        // We'll emit into a temporary directory in memory.
        const tempOutDir = 'temp-dist';
        this.project.compilerOptions.set({
            declaration: true,       // IMPORTANT: Enable .d.ts file generation
            emitDeclarationOnly: true, // IMPORTANT: Don't generate .js files
            outDir: tempOutDir,      // Specify a temporary output directory
        });

        // 2. Run the TypeScript emitter. This is an async operation.
        const emitResult = await this.project.emit();

        // Check for any errors during the emit process itself.
        const diagnostics = emitResult.getDiagnostics();
        if (diagnostics.length > 0) {
            console.error(this.project.formatDiagnosticsWithColorAndContext(diagnostics));
            throw new Error('Encountered errors during declaration file emission.');
        }

        // 3. Read the generated .d.ts file from the virtual file system.
        const emittedFilePath = path.join(tempOutDir, '__temp_filter_types__.d.ts');
        const emittedFile = this.project.getSourceFileOrThrow(emittedFilePath);

        // 4. Write the content of the fully resolved file to the final destination.
        const outputFile = this.project.createSourceFile(this.outputFilePath, emittedFile.getFullText(), {
            overwrite: true,
        });

        // Clean up the temporary emitted file so it doesn't interfere with other operations.
        this.project.removeSourceFile(emittedFile);

        await outputFile.save();
        console.log(`Successfully compiled filter types to ${this.outputFilePath}`);
    }

    private findTaggedTypeAliases(): TypeAliasDeclaration[] {
        const sourceFiles = this.project.getSourceFiles();
        const taggedTypeAliases: TypeAliasDeclaration[] = [];

        for (const sourceFile of sourceFiles) {
            if (sourceFile.isDeclarationFile() || sourceFile.getBaseName().startsWith('__temp')) {
                continue;
            }
            const typeAliases = sourceFile.getDescendantsOfKind(SyntaxKind.TypeAliasDeclaration);
            for (const typeAlias of typeAliases) {
                if (this.hasPrecompileFilterTag(typeAlias.getJsDocs())) {
                    taggedTypeAliases.push(typeAlias);
                }
            }
        }
        return taggedTypeAliases;
    }

    private hasPrecompileFilterTag(jsDocs: JSDoc[]): boolean {
        return jsDocs.some(doc =>
            doc.getTags().some(tag => tag.getTagName() === 'precompile-filter')
        );
    }
}