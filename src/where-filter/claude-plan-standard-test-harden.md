# Goal

The @standardTests.ts is vital in that is verifies every WhereFilter matching component (e.g. matchJavascriptObject, postgresWhereClauseBuilder, sqliteWhereClauseBuilder). It's the dominant full test for a WhereFilterDefinition. 



# Relevant Files

@standardTests.ts
@types.ts
@schemas.ts
@consts.ts
@typeguards.ts
@matchJavascriptObject.ts
@postgresWhereClauseBuilder.ts
@sqliteWhereClauseBuilder.ts
@whereClauseEngine.ts

# Context 

A `WhereFilterDefinition` is a serialisable JSON definition of a WHERE clause that can be used to filter Javascript objects (see @matchJavascriptObject.ts as an example).

It's inspired by MongoDB. 

The current testing suite is good; but it's not exhaustive enough for 100% confidence that the tests match the structure. 

# The WhereFilterDefinition spec
_To be filled in_

# The Current standardTests structure and coverage
_To be filled in_

# Gap analysis: where the spec is not fully tested in standardTests
_To be filled in: do high level then specific tests_

# Constraint

# Plan

_Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._

# [ ] Phase 1

Analyse the types for WhereFilterDefinition, knowing it's inspired by MongoDB, and create an accurate spec in this document under 'The WhereFilterDefinition spec'.

# [ ] Phase 2

Analyse the current standardTests.ts and build a mental model of what it's testing, in a hierarchy. Aim to be descriptive in relation to the spec - i.e. goal/property driven. Write up in this document under 'The Current standardTests structure and coverage'. 

# [ ] Phase 3

Do the gap analysis to see where the current standardTests are failing to exhaustively check a matching function conforms to the spec (including edge cases).
Do it in two broad steps: 
1) Look at the high level of the spec and what's present in the file. The test file should be driven by the spec and so should match its broad structure. 
2) For each section of the spec identified, look at the specific details and identify where the spec is lacking a test in the standardTests. Pay special mind to achieving full coverage, and especialy to edge cases. 

Also look at the security/hardening section and make sure that's not missed anything - put in a seperate section. 

The purpose of this gap analysis is to lay the foundations to fix it in a later phase. So this is identifying problems that will be addressed. 

# [ ] Phase 4

Restructure standardTests.ts to use nesting describe blocks to match the spec hierarchy identified in `The WhereFilterDefinition spec`. It should give a shape/structure that gives confidence to a developer reading the tests that all parts are covered.

Important: do not rewrite/add/remove any tests at this stage. Just relocate them as needed.

# [ ] Phase 5

Implement the missing tests identified in `Gap analysis: where the spec is not fully tested in standardTests`.

# [ ] Phase 6

_Deferred: this will compare standardTests.ts to the new one to find gaps. Will also run through Gemini._

