// compiler.ts (Fixed)
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

    // Import WhereFilterDefinition first
    const declarationFile = this.project.getSourceFileOrThrow(
      (sf) => sf.getFilePath().endsWith('index-where-filter-type.d.ts')
    );
    tempSourceFile.addImportDeclaration({
      moduleSpecifier: tempSourceFile.getRelativePathAsModuleSpecifierTo(declarationFile)+".d.ts",
      isTypeOnly: true,
      namedImports: ['WhereFilterDefinition'],
    });

    for (const typeAlias of taggedTypeAliases) {
      const originalTypeName = typeAlias.getName();
      const filterTypeName = `${originalTypeName}Filter`;
      filterTypeNames.push(filterTypeName);

      
      // Get the source file of the original type alias.
      const originalTypeSourceFile = typeAlias.getSourceFile();
      // Add an import for the original type (e.g., `User`) into the temp file.
      tempSourceFile.addImportDeclaration({
        moduleSpecifier: tempSourceFile.getRelativePathAsModuleSpecifierTo(originalTypeSourceFile),
        namedImports: [originalTypeName],
      });
      

      // This now works because both `WhereFilterDefinition` and `User` are imported.
      tempSourceFile.addTypeAlias({
        name: filterTypeName,
        isExported: true,
        type: `WhereFilterDefinition<${originalTypeName}>`,
      });
    }

    const outputFile = this.project.createSourceFile(this.outputFilePath, '', {
      overwrite: true,
    });

    console.log("FILE", tempSourceFile.getFullText());
    /**
     * #PROGRESS
     * FILE: 
     * import type { WhereFilterDefinition } from "./index-where-filter-type.d.ts"; // correct path
     * import { User } from "./src/models/user"; // correct path (I think)
     * 
     * export type UserFilter = WhereFilterDefinition<User>;
     */

    // Check for errors before proceeding
    const diagnostics = tempSourceFile.getPreEmitDiagnostics();
    if (diagnostics.length > 0) {
      console.error(this.project.formatDiagnosticsWithColorAndContext(diagnostics));
      throw new Error('Encountered errors during type analysis.');
    }

    const typeChecker = this.project.getProgram().getTypeChecker();

    for (const filterTypeName of filterTypeNames) {
      const filterTypeAlias = tempSourceFile.getTypeAliasOrThrow(filterTypeName);
      const type = typeChecker.getTypeAtLocation(filterTypeAlias);

      const apparentType = type.getApparentType();

      outputFile.addTypeAlias({
        name: filterTypeName,
        isExported: true,
        type: writer => {
          writer.inlineBlock(() => {
            console.log("START PROPS"); // #PROGRESS This outputs (runs)
            for (const prop of apparentType.getProperties()) {
                console.log("START PROP"); // #PROGRESS THIS DOES NOT RUN! 
              const propType = prop.getTypeAtLocation(filterTypeAlias);
              console.log("PROP", filterTypeName, propType);
              const propTypeText = propType.getText(filterTypeAlias);
              /*typeChecker.typeToString(
                propType,
                filterTypeAlias,
              );*/
              writer.writeLine(`'${prop.getName()}': ${propTypeText};`);
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
      // Exclude declaration files and our own temporary files from the search
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