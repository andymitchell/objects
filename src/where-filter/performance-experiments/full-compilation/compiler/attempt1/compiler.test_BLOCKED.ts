import { generateFiltersFromSource, getDependencyMapForEntrypoint } from "./compiler.ts";
import {readFileSync} from "fs";
import {dirname, resolve} from "path";
import { fileURLToPath } from "url";
import {it} from 'vitest';


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const helpersSourceCode = readFileSync(resolve(__dirname, '../types.ts'), 'utf-8');
console.log({helpersSourceCode})

let helperDependencies: Map<string, string>;

    // Use beforeAll to resolve the helper files once from the disk
    // This makes tests faster and mimics loading these modules once.
    beforeAll(async () => {
        const helpersEntryPoint = resolve(__dirname, '../types.ts');
        helperDependencies = await getDependencyMapForEntrypoint(helpersEntryPoint);
    });

it('should generate a filter for a simple type', async () => {
    console.log(helperDependencies);

        const modelSource = {
            path: '/models/data.ts', // Use a virtual path
            content: `
                

                /**
                 * @precompile-filter
                 */
                export type Order = {
                    orderId: string;
                    customer: {
                        id: string;
                        address: {
                            city: string;
                        }
                    }
                };
            `
        };

        const result = await generateFiltersFromSource(modelSource, helperDependencies);

        console.log(result);

        // Check that the output string contains the expected definitions
        expect(result).toContain('export type UserFilter = {');
        expect(result).toContain(`'name'?: string`);
        expect(result).toContain(`'age'?: number`);
});