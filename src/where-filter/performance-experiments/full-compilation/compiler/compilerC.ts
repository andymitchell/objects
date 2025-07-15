import { JSDoc, Project, SourceFile, SyntaxKind, TypeAliasDeclaration } from 'ts-morph';

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

  public compile() {
    const taggedTypeAliases = this.findTaggedTypeAliases();
    if (taggedTypeAliases.length === 0) {
      console.log('No types with a "@precompile-filter" tag found.');
      return;
    }

    

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

      // #ERROR Generates `export type UserFilter = WhereFilterDefinition<User>;`, but does not import User. 
      tempSourceFile.addTypeAlias({
        name: filterTypeName,
        isExported: true,
        type: `WhereFilterDefinition<${originalTypeName}>`,
      });
    }

    console.log(this.project.getSourceFiles().map(x => x.getFilePath()))

    // Add imports to the temporary file
    const declarationFile = this.project.getSourceFileOrThrow(
        (sf) => sf.getFilePath().endsWith('index-where-filter-type.d.ts')
    );
    const moduleSpecifier = tempSourceFile.getRelativePathAsModuleSpecifierTo(declarationFile);
    console.log({moduleSpecifier})

    tempSourceFile.addImportDeclaration({
        moduleSpecifier,
        namedImports: ['WhereFilterDefinition'],
    });

    const outputFile = this.project.createSourceFile(this.outputFilePath, '', {
      overwrite: true,
    });

    const diagnostics = tempSourceFile.getPreEmitDiagnostics();
    if (diagnostics.length > 0) {
      console.error(this.project.formatDiagnosticsWithColorAndContext(diagnostics));
      throw new Error('Encountered errors during type analysis.');
    }

    const program = this.project.getProgram();
    const typeChecker = program.getTypeChecker();

    for (const filterTypeName of filterTypeNames) {
      const filterTypeAlias = tempSourceFile.getTypeAliasOrThrow(filterTypeName);
      const type = typeChecker.getTypeAtLocation(filterTypeAlias);

      outputFile.addTypeAlias({
        name: filterTypeName,
        isExported: true,
        type: writer => {
          writer.inlineBlock(() => {
            for (const prop of type.getProperties()) {
              const propType = prop.getTypeAtLocation(filterTypeAlias);
              writer.writeLine(`'${prop.getName()}': ${propType.getText(filterTypeAlias)},`);
            }
          });
        },
      });
    }

    outputFile.saveSync();
    console.log(`Successfully compiled filter types to ${this.outputFilePath}`);
  }

  private findTaggedTypeAliases(): TypeAliasDeclaration[] {
    const sourceFiles = this.project.getSourceFiles();
    const taggedTypeAliases: TypeAliasDeclaration[] = [];

    for (const sourceFile of sourceFiles) {
      const typeAliases = sourceFile.getDescendantsOfKind(SyntaxKind.TypeAliasDeclaration);
      for (const typeAlias of typeAliases) {
        const hasPrecompileTag = this.hasPrecompileFilterTag(typeAlias.getJsDocs());
        if (hasPrecompileTag) {
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