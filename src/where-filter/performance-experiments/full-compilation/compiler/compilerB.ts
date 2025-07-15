import { JSDoc, Project, SourceFile, SyntaxKind, TypeAliasDeclaration, ts } from 'ts-morph';

export interface CompilerOptions {
  /** The ts-morph project, pre-loaded with consumer source files and the WhereFilterDefinition file. */
  project: Project;
  /** The absolute path for the generated output file. */
  outputFilePath: string;
}

export class WhereFilterCompiler {
  private readonly project: Project;
  private readonly outputFilePath: string;

  constructor(options: CompilerOptions) {
    this.project = options.project;
    this.outputFilePath = options.outputFilePath;
  }

  public compile() {
    const taggedTypeAliases = this.findTaggedTypeAliases();
    if (taggedTypeAliases.length === 0) {
      console.log('No types with a "@precompile-filter" tag found.');
      return;
    }

    // Create a temporary source file in memory. This file is a canvas for the type checker.
    // It doesn't need imports because all types are already part of the same Project.
    const tempSourceFile = this.project.createSourceFile(
      '__temp_filter_types__.ts',
      '',
      { overwrite: true }
    );

    const filterTypeNames: string[] = [];

    for (const typeAlias of taggedTypeAliases) {
      const originalTypeName = typeAlias.getName();
      const filterTypeName = `${originalTypeName}Filter`;
      filterTypeNames.push(filterTypeName);

      // Add a new type alias like `type UserFilter = WhereFilterDefinition<User>;`
      // The type checker can resolve this because `User` and `WhereFilterDefinition` are in the project.
      tempSourceFile.addTypeAlias({
        name: filterTypeName,
        isExported: true,
        type: `WhereFilterDefinition<${originalTypeName}>`,
      });
    }

    // It's good practice to check for diagnostic errors (e.g., type not found).
    const diagnostics = this.project.getProgram().getSyntacticDiagnostics(tempSourceFile);
    if (diagnostics.length > 0) {
      console.error(this.project.formatDiagnosticsWithColorAndContext(diagnostics));
      throw new Error('Encountered errors during temporary type generation.');
    }

    const outputFile = this.project.createSourceFile(this.outputFilePath, '', {
      overwrite: true,
    });

    const typeChecker = this.project.getProgram().getTypeChecker();

    for (const filterTypeName of filterTypeNames) {
      const filterTypeAlias = tempSourceFile.getTypeAliasOrThrow(filterTypeName);
      const type = typeChecker.getTypeAtLocation(filterTypeAlias);

      // Add the fully resolved type to the output file.
      outputFile.addTypeAlias({
        name: filterTypeName,
        isExported: true,
        type: writer => {
          writer.inlineBlock(() => {
            for (const prop of type.getProperties()) {
              const propType = prop.getTypeAtLocation(filterTypeAlias);
              const propTypeText = typeChecker.typeToString(propType, prop.getDeclarations()?.[0]);
              // Write property like: "address.city": string;
              writer.writeLine(`'${prop.getName()}': ${propTypeText};`);
            }
          });
        },
      });
    }

    outputFile.saveSync();
    console.log(`Successfully compiled filter types to: ${this.outputFilePath}`);
  }

  /** Finds all exported type aliases with a @precompile-filter JSDoc tag. */
  private findTaggedTypeAliases(): TypeAliasDeclaration[] {
    const sourceFiles = this.project.getSourceFiles();
    const taggedTypeAliases: TypeAliasDeclaration[] = [];

    for (const sourceFile of sourceFiles) {
      // We don't want to scan .d.ts files or our own temporary files
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