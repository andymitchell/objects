# DEFERRED

Stanard tests must updated as per spec first 

# Goal

Exhaustively check the spec/intention of WhereFilterDefinition is correctly represented in the types by rewriting @types.test.ts to match the spec (similar to how it's structured in standardTests.ts with nested `describe` blocks representing the hierarchy of the spec).

# Relevant Files

@types.ts
@types.test.ts
@schemas.ts
@standardTests.ts
@consts.ts
@typeguards.ts
@matchJavascriptObject.ts

# Context 

A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts as an example).

It's inspired by MongoDB. 

The current @types.test.ts is extremely patchy and weak. 

The current testing suite is good; but it's not exhaustive enough for 100% confidence that the tests match the structure. 

# The WhereFilterDefinition spec
_To be filled in - bring across from @claude-plan-standard-test-harden.md_

# The Current types.test.ts important cases
_To be filled in_

# Constraint

* Do not fix/change/alter any actual types. I must provide my express approval for it. 

# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [ ] Phase 1

Analyse the current types.test.ts and build a mental model of what it's testing. Extract any unique tests we wouldn't want to lose, and document them here under 'The Current types.test.ts important cases'. 

# [ ] Phase 2

Generate an implementation plan for how types.test.ts will be written from the ground up to verify that the types fully match the intention/statement of the spec; AND keeps all important tests that currently exist in types.test.ts; ending up with a types.test.ts that well structured in a way that will be understood by any dev (i.e. it matches the structure of the spec). 

# [ ] Phase 3

Implement the steps of this plan to write a new types.test.ts
_To be filled in by Phase 2_

# [ ] Phase 4

Run the type tests, and identify any type errors but DO NOT FIX THEM. Instead talk to me about why those tests are failing, as I'm very confident that the current WhereFilterDefinition type is correct and I'll need strong evidence to persuade me otherwise. Basically if there's a mismatch, we're going to have to figure out if the type or the spec is wrong in a manual investigation. 