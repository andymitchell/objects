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

    // Create a single, isolated "scratchpad" file in memory. This strategy avoids all module resolution issues.
    const scratchpadFile = this.project.createSourceFile(
      '__compiler_scratchpad__.ts',
      '',
      { overwrite: true }
    );

    // Copy the WhereFilterDefinition type alias into the scratchpad.
    const declarationFile = this.project.getSourceFileOrThrow(
        (sf) => sf.getFilePath().endsWith('index-where-filter-type.d.ts')
    );
    const whereFilterDefinition = declarationFile.getTypeAliasOrThrow('WhereFilterDefinition');
    scratchpadFile.addTypeAlias(whereFilterDefinition.getStructure());

    const resolverTypeNames: { original: string, resolver: string }[] = [];
    for (const typeAlias of taggedTypeAliases) {
      const originalTypeName = typeAlias.getName();
      
      // Copy the user's type (e.g., `User`) into the scratchpad.
      scratchpadFile.addTypeAlias(typeAlias.getStructure());

      const resolverTypeName = `__Resolved${originalTypeName}Filter`;
      resolverTypeNames.push({ original: originalTypeName, resolver: resolverTypeName });

      // Add `export type __ResolvedUserFilter = WhereFilterDefinition<User>;` to the scratchpad.
      scratchpadFile.addTypeAlias({
        name: resolverTypeName,
        isExported: true,
        type: `WhereFilterDefinition<${originalTypeName}>`,
      });
    }

    console.log("FILE", scratchpadFile.getFullText())

    const outputFile = this.project.createSourceFile(this.outputFilePath, '', {
      overwrite: true,
    });
    const typeChecker = this.project.getProgram().getTypeChecker();

    for (const { original, resolver } of resolverTypeNames) {
      const finalFilterName = `${original}Filter`;
      const resolverAlias = scratchpadFile.getTypeAliasOrThrow(resolver);

      const type = typeChecker.getTypeAtLocation(resolverAlias);
      const apparentType = type.getApparentType();

      outputFile.addTypeAlias({
        name: finalFilterName,
        isExported: true,
        type: writer => {
          writer.inlineBlock(() => {
            for (const prop of apparentType.getProperties()) {
              const propType = prop.getTypeAtLocation(resolverAlias);
              
              // --- THE FIX IS HERE ---
              // Use the .getText() method on the Type object itself. This is the correct ts-morph API.
              const propTypeText = propType.getText(resolverAlias);
              // ---------------------
              
              writer.writeLine(`'${prop.getName()}': ${propTypeText};`);
            }
          });
        },
      });
    }
    
    outputFile.saveSync();
    console.log(`Successfully compiled filter types to ${this.outputFilePath}`);
    this.project.removeSourceFile(scratchpadFile);
  }

  private findTaggedTypeAliases(): TypeAliasDeclaration[] {
    const sourceFiles = this.project.getSourceFiles();
    const taggedTypeAliases: TypeAliasDeclaration[] = [];

    for (const sourceFile of sourceFiles) {
      if (sourceFile.isDeclarationFile() || sourceFile.getBaseName().startsWith('__')) {
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