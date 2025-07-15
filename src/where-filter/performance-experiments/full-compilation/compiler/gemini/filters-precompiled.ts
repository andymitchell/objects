// This file is auto-generated. Do not edit manually.

type WhereFilterDefinition<T> = Partial<T> | { AND?: WhereFilterDefinition<T>[]; OR?: WhereFilterDefinition<T>[]; NOT?: WhereFilterDefinition<T>[]; };; // I manu

export type UserFilter = Partial<{
  "address"?: { "city": string; "zip": number };
  "address.city"?: string | { "contains": string };
  "address.zip"?: number | { "lt"?: number; "gt"?: number; "lte"?: number; "gte"?: number };
  "name"?: string | { "contains": string };
  "siblings"?: { name: string; pets: { name: string; age: number; }[]; }[] | { "name"?: string | { "contains": string }; "pets"?: { name: string; age: number; }[] | { "name"?: string | { contains: string; }; "age"?: number | Partial<Record<"lt" | "gt" | "lte" | "gte", number>> } | { AND?: WhereFilterDefinition<{ name: string; age: number; }>[]; OR?: WhereFilterDefinition<{ name: string; age: number; }>[]; NOT?: WhereFilterDefinition<{ name: string; age: number; }>[] } | { elem_match: WhereFilterDefinition<{ name: string; age: number; }>; } } | { AND?: WhereFilterDefinition<{ name: string; pets: { name: string; age: number; }[]; }>[]; OR?: WhereFilterDefinition<{ name: string; pets: { name: string; age: number; }[]; }>[]; NOT?: WhereFilterDefinition<{ name: string; pets: { name: string; age: number; }[]; }>[] } | { elem_match: WhereFilterDefinition<{ name: string; pets: { name: string; age: number; }[]; }>; };
  "siblings.pets"?: { name: string; age: number; }[] | { "name"?: string | { "contains": string }; "age"?: number | { "lt"?: number; "gt"?: number; "lte"?: number; "gte"?: number } } | { AND?: WhereFilterDefinition<{ name: string; age: number; }>[]; OR?: WhereFilterDefinition<{ name: string; age: number; }>[]; NOT?: WhereFilterDefinition<{ name: string; age: number; }>[] } | { elem_match: WhereFilterDefinition<{ name: string; age: number; }>; }
}> | { AND?: UserFilter[]; OR?: UserFilter[]; NOT?: UserFilter[]; };
