# Goal

Extend what a Write Action can do with Mongo-esque `addToSet` + `pull` + `push` (on array properties), and `inc` (on number properties).
They are specific `update` actions, in comparison to the current generic `update` write payload. 

It will work with the type system (limiting what paths these can be used on to match their type). 

It will be thoroughly tested. 

# Context

The current system has an 'update' that applies a partial delta change to any object matching the Where Filter. See ` WriteActionPayloadUpdate` in @./types.ts

This works great, but can collide if multiple updates try to occur at once. The proposed changes allow multiple property changes without conflict. 

# Constraints 
Don't try to alter how it identifies arrays with the helper types - this has already been done (it was used in array_scope). 
Note array_scope is important to know about - it basically namespaces/scopes the write actions to each object in an array (that becoming the new start point). 





# Relevant Files

@./types.ts
@./write-action-schemas.ts
@./applyWritesToItems/types.ts
@./applyWritesToItems/schemas.ts
@./applyWritesToItems/applyWritesToItems.ts
@./applyWritesToItems/applyWritesToItems.test.ts




# Proposed New Types
_To be filled in_

# Understanding Type Helpers

# What Works in SQL too? 
_To be filled in_

# Learning From Mingo
_To be filled in_

# Edge Case Behaviours
_To be filled in_

# Implementation Plan
_To be filled in_



# Project Plan

_Instructions: Check the Phases off as you go. Stop after each phase to ask me whether to continue to the next phase. If you create files as part of completing a Phase, update the Phase with links to them and explain what they contain (so a future LLM can resume)._


# [ ] Phase 0

Look at the current code base to understand how it automatically detects the type of a property in a generic T, so it knows that propertyX is a number, propertyY is an array. 

Also, separately understand the DDL and how it defines primary key for a list (which is each nested array starting from root).

Document, succinctly, how to use this when writing new types and output to `Understanding Type Helpers`

# [ ] Phase 1

Identify the current update type in @./types.ts, and explore options for how the new type will look for the actions. 
- Is it brand new payloads ('update', 'update-add-to-set', etc.)
- Is it just the 'update' payload but overloaded with a sub option? 

Explore pros & cons of each, output that into our chat, then ask me which to choose.

Remember that addToSet + pull + push must only be on array types; and inc only on number. 

Unlike Mongo, I propose addToSet and push can add multiple items in one go. Also for addToSet it should clarify whether to check just on an id (the primary key expressed in DDL for that list), or to do deep equals equality. 

Output the decision and types into `Proposed New Types`. 


# [ ] Phase 2

I will later be making a variant of `applyWritesToItems` that works with SQL by generating an UPDATE statement on objects stored in a JSON column. In both pg and sqlite. 

For each db engine, tell me which new mutations can be natively expressed in an UPDATE statement on a JSON object. Alternatively can they do it with multiple SQL expressions in a transaction? 

For addToSet, be sure to consider uniqueness detect on a primary key id on the object vs deep equals. Can the engines support either? 

For each, flag if it's too difficult to replicate in SQL. 

Output findings to `What Works in SQL too?`


# [ ] Phase 3

Analyse code internals for kofrasa/Mingo on github. It's not directly useable - the repo is an in-memory solution only (whereas we're planning to support many sources) - but they will certainly have learnt lessons we can use. 

Is there anything we can learn from their code base: have they documented any hard won lessons or edge cases, can you detect any good ideas in their code, can you spot sub-optimal things they've done? 

Summarise your discovery and output the lessons as declarative "Implementation Tips" in `Learning From Mingo`

# [ ] Phase 4

Identify edge case behaviours for each new update action (and its various inputs, e.g. deep equality testing). These will need to be tracked through implementation. 

Add to `Edge Case Behaviours`. 

# [ ] Phase 4

Generate an implementation plan that will update the types and schemas, update `applyWritesToItems`, and update the tests with full coverage as per our approach to testing. Output to `Implementation Plan`. 

# [ ] Phase 4a

Pass plan to Gemini for feedback. Output me the current implementation plan, and additional context it needs (e.g. relevant types, spirit of library), and a request to conscisely critique. 

# [ ] Phase 5

Implement the plan in `Implementation Plan`. 

Where it makes sense aim for a red/green TDD process. Expand standardTests, using its current structural philosphy (but add to it), to handle these new tests. 

# [ ] Phase 6

How would we add UPSERT to the system? It would need a where-filter for collision detection? What are the consequences (changes, maintenance) of this add? 

Suppose the underlying implementation simply didn't support UPSERT (e.g. it's a data library without upsert mechanics)... is it *always* possible to expand an UPSERT into other conditional WriteActions to compensate (e.g. run a CREATE but don't throw if exists, then run UPDATE). I.e. it's slower but can workaround as fallback? 