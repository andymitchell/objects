The WhereFilterDefinition is super complex, with exponential path expansion and deep recursion. I.e. it's slow. 

**IMPORTANT PAUSE**: DO NOT TRY AGAIN TO OPTIMISE UNTIL WhereFilterDefinition IS ACTUALLY FINISHED. THERE ARE STILL SOME POSSIBLY BIG CHANGES TO MAKE TO MOVE IT CLOSER TO MONGO. 

# Summary

- Wait until WhereFilterDefinition is in its final form. Consider buying a faster laptop first! 
- Build an actual baseline for performance with https://github.com/microsoft/typescript-analyze-trace 
- Test to see if adhoc usage of WhereFilterDefinition is worse than defining 'UserFilter = WhereFilterDefinition<User>' once.
- Try to see if simply adding depth guards (especially on logic/array filter) gives good returns. Consider stopping if so. 
- Try the partial compilation that's lighter (`wherefilter_with_precompile_step.ts`) 


# Why you probably shouldn't care about performance

But the benefits it gives for DX are real: 
- Don't have to try to recall the shape of objects to filter
- Guards against schema change for much stronger maintenance 

The good news is, the problem has a shelf life: 
- Typescript 7 is coming with 10x compiler improvements
- My current fast laptop (2021) has already been doubled with the 2024 model (Geekbench)

Also, ElectricSql must have solved it. They've moved away from the old querying style system on 17th July 2024 https://github.com/electric-sql/electric-old. It's possible they don't allow nesting (looking at examples) which makes sense for a flat table structure. 

# But the reality is sometimes typing gets sluggish

There are two broad approaches to improvement: 
1. Try to optimise the current types
2. Pre-compile some types


## 1. Optimising the current types

Some definition ideas: 
- Putting a limit on recursive depth (I suspect especially for the boolean logic which is bottomless). 
    - Perhaps WhereFilterDefinition itself should have an optional depth, so it defaults to small, but can be increased
- Path is particularly expensive, as it constructs new template literals and recurses into them. 


I'm not sure, but I suspect, that adopting a style practice of creating *Filter types for common types is a better idea than doing it adhoc everywhere. 
E.g. 
✖ find<WhereFilterDefinition<User>>()
✔ type UserFilter = WhereFilterDefinition<User>;
✔ find<UserFilter>()

## 2. Precompiling

A caveat to this is the long term goal is to precompile only until TS7 comes along, then switch back. 

### full-compilation

You can see the efforts in the `full-compilation` folder. Some of them actually came close, but they're all _approximations_. Which is the main reason not to use them, as there will be tiny but infuriating differences with the dynamic version. 

The plan was to tag types with JSDoc, e.g. `@precompile-filter`, and have a build script that uses ts-morph to convert those files. 

Bringing the filter into ts-morph was also hard, but the key was to output it as index-where-filter-type.d.ts, then read that file in, then load it as an in-memory source code into ts-morph (as part of the project that uses the consumer/target project). 

As you can see in `gemini/compile.ts` it's closest when you force in a simplified definition of WhereFilterDefinition for the cases where it couldn't output.

### partial-compilation

wherefilter_with_precompile_step.ts looks most promising (albeit I'm not sure what performance gains it gives); as it requires a relatively small change, compiling only a small part, so it should stay more easily aligned with the dynamic version. 

continuing_full_compilation.ts has a bigger idea of precompiling all the permutations. But it requires introducing some new potentially-divergent helper types. 