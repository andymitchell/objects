import { Project } from 'ts-morph';
import { describe, it, expect, beforeEach } from 'vitest';
import { WhereFilterCompiler } from './compiler.ts';
import path from 'path';
import { existsSync, readFileSync } from 'fs';

describe('WhereFilterCompiler', () => {
    let project: Project;

    beforeEach(() => {
        project = new Project({ 
            useInMemoryFileSystem: true,
            //skipAddingFilesFromTsConfig: true,
         });

        const helperPath = path.resolve(process.cwd(), './dist/index-where-filter-type.d.ts');
        if( !existsSync(helperPath) ) throw new Error("No existy");

        const fileContent = readFileSync(helperPath, 'utf8');

        const sourceFile = project.createSourceFile('./index-where-filter-type.d.ts', fileContent);
        //const files = project.addSourceFileAtPath(helperPath);

        //const files = project.addSourceFilesAtPaths('./dist/index-where-filter-type.d.ts');
        //console.log("Found files: ", files);

});

it('should compile a type with a @precompile-filter tag', async () => {
    // Simulate a user's source file
    project.createSourceFile(
        'src/models/user.ts',
        `
      /**
       * @precompile-filter
       */
      export type User = {
        name: string;
        age: number;
        address: {
          city: string;
          zip: number;
        }
      };
      `
    );

    const outputFilePath = 'src/generated/user-filter.ts';
    const compiler = new WhereFilterCompiler({
        project,
        outputFilePath,
    });

    await compiler.compile();

    const outputFile = project.getSourceFile(outputFilePath);
    expect(outputFile).toBeDefined();

    const expectedOutput = `type UserFilter = {
    'name': string,
    'age': number,
    'address.city': any,
    'address.zip': any,
};
`;

    // Normalize whitespace for comparison
    const actualText = outputFile!.getText().replace(/\s+/g, ' ').trim();
    const expectedText = expectedOutput.replace(/\s+/g, ' ').trim();

    expect(actualText).toContain(expectedText);
});
});