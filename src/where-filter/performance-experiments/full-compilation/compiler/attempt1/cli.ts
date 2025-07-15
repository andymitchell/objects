
// =================================================================================
// 3. FILE-SYSTEM ENTRY POINT (The Build Script)
// This is the primary script to run from the command line.
// =================================================================================

import { Project } from "ts-morph";
import { processProjectForFilters } from "./compiler.ts";
import {resolve} from "path";



/**
 * Main function to run the build script. Loads files from the filesystem,
 * generates filters, and writes the output to a file.
 */
async function main() {
    console.log("Running filter generation from filesystem...");
    const project = new Project({
        tsConfigFilePath: "tsconfig.json",
    });

    // Run the same core processing logic
    const generatedFileContent = await processProjectForFilters(project);

    // Write the result to a file
    const outputPath = resolve(process.cwd(), "src/generated-filters.ts");
    project.createSourceFile(outputPath, generatedFileContent, { overwrite: true });

    await project.save();
    console.log(`\nSuccessfully generated filters to ${outputPath}`);
}

// Only run main if this script is executed directly
if (require.main === module) {
    main().catch(e => {
        console.error(e);
        process.exit(1);
    });
}
