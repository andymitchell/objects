#!/usr/bin/env node

import { Project } from 'ts-morph';
import { Command } from 'commander';
import { WhereFilterCompiler } from './compilerB.ts';
import * as path from 'path';

const program = new Command();

program
  .name('where-filter-compiler')
  .description('Precompiles WhereFilterDefinition types.')
  .requiredOption(
    '-p, --project <path>',
    'Path to the tsconfig.json of the consumer project.'
  )
  .requiredOption(
    '-d, --definitions <path>',
    'Path to the index-where-filter-type.d.ts file.'
  )
  .requiredOption(
    '-o, --output <path>',
    'Output path for the generated filter types file.'
  );

program.parse(process.argv);
const options = program.opts();

const project = new Project({
  tsConfigFilePath: path.resolve(process.cwd(), options.project),
});

project.addSourceFileAtPath(path.resolve(process.cwd(), options.definitions));

const compiler = new WhereFilterCompiler({
  project,
  outputFilePath: path.resolve(process.cwd(), options.output),
});

try {
  compiler.compile();
} catch (error) {
  console.error('Compilation failed:', error);
  process.exit(1);
}