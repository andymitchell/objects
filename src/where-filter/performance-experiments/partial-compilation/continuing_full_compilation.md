
This was the last output of the gemini compile.ts
```ts

// I added this: 
type WhereFilterDefinition<T> = Partial<T> | { AND?: WhereFilterDefinition<T>[]; OR?: WhereFilterDefinition<T>[]; NOT?: WhereFilterDefinition<T>[]; };;

// The actual output: 
export type UserFilter = Partial<{
  "address"?: { "city": string; "zip": number };
  "address.city"?: string | { "contains": string };
  "address.zip"?: number | { "lt"?: number; "gt"?: number; "lte"?: number; "gte"?: number };
  "name"?: string | { "contains": string };
  "siblings"?: { name: string; pets: { name: string; age: number; }[]; }[] | { "name"?: string | { "contains": string }; "pets"?: { name: string; age: number; }[] | { "name"?: string | { contains: string; }; "age"?: number | Partial<Record<"lt" | "gt" | "lte" | "gte", number>> } | { AND?: WhereFilterDefinition<{ name: string; age: number; }>[]; OR?: WhereFilterDefinition<{ name: string; age: number; }>[]; NOT?: WhereFilterDefinition<{ name: string; age: number; }>[] } | { elem_match: WhereFilterDefinition<{ name: string; age: number; }>; } } | { AND?: WhereFilterDefinition<{ name: string; pets: { name: string; age: number; }[]; }>[]; OR?: WhereFilterDefinition<{ name: string; pets: { name: string; age: number; }[]; }>[]; NOT?: WhereFilterDefinition<{ name: string; pets: { name: string; age: number; }[]; }>[] } | { elem_match: WhereFilterDefinition<{ name: string; pets: { name: string; age: number; }[]; }>; };
  "siblings.pets"?: { name: string; age: number; }[] | { "name"?: string | { "contains": string }; "age"?: number | { "lt"?: number; "gt"?: number; "lte"?: number; "gte"?: number } } | { AND?: WhereFilterDefinition<{ name: string; age: number; }>[]; OR?: WhereFilterDefinition<{ name: string; age: number; }>[]; NOT?: WhereFilterDefinition<{ name: string; age: number; }>[] } | { elem_match: WhereFilterDefinition<{ name: string; age: number; }>; }
}> | { AND?: UserFilter[]; OR?: UserFilter[]; NOT?: UserFilter[]; };
```

It actually looks like its done the hard thing of permutations on the object.

If we could make the compiler output this instead: 
```ts

export type UserFilter = Partial<{
  "address"?: { "city": string; "zip": number };
  "address.city"?: string | { "contains": string };
  "address.zip"?: number | { "lt"?: number; "gt"?: number; "lte"?: number; "gte"?: number };
  "name"?: string | { "contains": string };
  "siblings"?: { name: string; pets: { name: string; age: number; }[]; }[] | { "name"?: string | { "contains": string }; "pets"?: { name: string; age: number; }[] | { "name"?: string | { contains: string; }; "age"?: number | Partial<Record<"lt" | "gt" | "lte" | "gte", number>> };
  "siblings.pets"?: { name: string; age: number; }[] | { "name"?: string | { "contains": string }; "age"?: number | { "lt"?: number; "gt"?: number; "lte"?: number; "gte"?: number } }}
}>

// Or even break it apart

type SiblingPets = { name: string; age: number; }[] | { "name"?: string | { "contains": string }; "age"?: number | { "lt"?: number; "gt"?: number; "lte"?: number; "gte"?: number }};
type Siblings = { name: string; pets: SiblingPets; }[] | { "name"?: string | { "contains": string }; "pets"?: SiblingPets[]; };
type UserFilter = Partial<{ 
  "address"?: { "city": string; "zip": number };
  "address.city"?: string | { "contains": string };
  "address.zip"?: number | { "lt"?: number; "gt"?: number; "lte"?: number; "gte"?: number };
  "name"?: string | { "contains": string };
  "siblings"?: Siblings;
  "siblings.pets"?: SiblingPets;
}>

```

Then we could wrap those constitutent parts in lighter utilities, like ArrayFilter (to add elem_match) and LogicFilter (with full recursion). 

The hard challenge is getting ts-morph to correctly pull them apart, and then figure what needs an array/logic filter. 
**Important**: DO NOT ATTEMPT THIS UNTIL IT'S FULLY SETTLED HOW WE'LL USE THE WHEREFILTER (IT'S STILL CHANGING).

