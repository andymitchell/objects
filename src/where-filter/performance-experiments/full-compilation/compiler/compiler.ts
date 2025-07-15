import { JSDoc, Project, SourceFile, SyntaxKind, TypeAliasDeclaration, InterfaceDeclaration, EnumDeclaration, Node } from 'ts-morph';

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

    const scratchpadFile = this.project.createSourceFile(
      '__compiler_scratchpad__.ts',
      '',
      { overwrite: true }
    );

    // --- RECURSIVE DEPENDENCY BUNDLING ---

    const addedDeclarationNames = new Set<string>();
    const declarationQueue: (TypeAliasDeclaration | InterfaceDeclaration | EnumDeclaration)[] = [];

    // 1. Seed the queue with our initial entry points.
    const declarationFile = this.project.getSourceFileOrThrow(
        (sf) => sf.getFilePath().endsWith('index-where-filter-type.d.ts')
    );
    declarationQueue.push(declarationFile.getTypeAliasOrThrow('WhereFilterDefinition'));
    declarationQueue.push(...taggedTypeAliases);

    // 2. Process the queue until all dependencies are found and added.
    while (declarationQueue.length > 0) {
      const declaration = declarationQueue.shift();
      if (!declaration || addedDeclarationNames.has(declaration.getName()!)) {
        continue;
      }
      
      // Add the declaration's structure to the scratchpad.
      if (Node.isTypeAliasDeclaration(declaration) || Node.isInterfaceDeclaration(declaration) || Node.isEnumDeclaration(declaration)) {
        scratchpadFile.addStatements([declaration.getStructure()]);
        addedDeclarationNames.add(declaration.getName()!);
      }

      // 3. Find all identifiers within this declaration and add their dependencies to the queue.
      const identifiers = declaration.getDescendantsOfKind(SyntaxKind.Identifier);
      for (const id of identifiers) {
        const symbol = id.getSymbol();
        if (!symbol) continue;

        for (const decl of symbol.getDeclarations()) {
          // We only care about declarations we can copy: Type Aliases, Interfaces, Enums.
          if (Node.isTypeAliasDeclaration(decl) || Node.isInterfaceDeclaration(decl) || Node.isEnumDeclaration(decl)) {
            // Avoid adding already-processed declarations.
            if (!addedDeclarationNames.has(decl.getName())) {
              declarationQueue.push(decl);
            }
          }
        }
      }
    }

    // 4. Now that the scratchpad is self-contained, add the "resolver" aliases.
    const resolverTypeNames: { original: string, resolver: string }[] = [];
    for (const typeAlias of taggedTypeAliases) {
        const originalTypeName = typeAlias.getName();
        const resolverTypeName = `__Resolved${originalTypeName}Filter`;
        resolverTypeNames.push({ original: originalTypeName, resolver: resolverTypeName });

        scratchpadFile.addTypeAlias({
            name: resolverTypeName,
            isExported: true,
            type: `WhereFilterDefinition<${originalTypeName}>`,
        });
    }

    // 5. With the complete scratchpad, we can safely resolve the types.
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
              const propTypeText = propType.getText(resolverAlias);
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