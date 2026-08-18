# Writes, `undefined`, `null`, and removing a property

How a data store should treat `undefined` is an open question that every library answers differently, so this library answers it explicitly. The short version: `undefined` is never a value you write, and each thing you might have meant by it has its own verb.

## Why there are rules at all

A `WriteAction` is an instruction rather than a mutation. It is built in one place, often stored or sent somewhere, and applied in another — so it has to survive JSON, and JSON has no `undefined`:

```ts
JSON.stringify({ text: undefined });   // '{}'  — the key is simply gone
```

An update carrying `{ text: undefined }` therefore asks for one thing before that journey and a different thing after it: on the far side there is no `text` key at all, and an update that names no key changes nothing.

Even with no journey involved, the value is ambiguous. It could mean *store `undefined` here*, or *take this property away*, or *I had nothing to say about this field*. Styles of applying an update answer that differently — merging into the row keeps unmentioned fields, replacing it does not — so the action's meaning would depend on the machinery that ran it.

Rather than pick a winner, the write language leaves `undefined` out and gives each intention a verb of its own.

## The rules

Examples below use this row:

```ts
const ProfileSchema = z.object({
    id: z.string(),
    nickname: z.string().optional(),
    bio: z.string().nullable().optional(),
}).strict();
```

**An explicit `undefined` in `create.data` or `update.data` is rejected.** The rejection happens at runtime, before anything is stored: the whole action fails as `invalid_data_value` — nothing is written, and the failure is unrecoverable, so no retry will make it work. The error carries the path of the offending field and a `message` naming what to do instead.

```ts
{ type: 'update', data: { nickname: undefined }, where: { id: '1' } }
// → invalid_data_value, data_path: 'nickname', nothing written
```

**In a create, omit the key instead.** A create defines the whole item, so there is no existing value to clear:

```ts
{ type: 'create', data: { id: '1' } }                        // ✔ nickname is simply absent
{ type: 'create', data: { id: '1', nickname: undefined } }   // ✘ refused
```

**Omitting a key in `update.data` means "leave it untouched".** An update is partial by omission, which is why it has no way to say "remove this" on its own:

```ts
{ type: 'update', data: { bio: 'hello' }, where: { id: '1' } }
// nickname keeps whatever it held
```

**`null` is an ordinary value.** It is stored, matched, and serialised like any other — it is not a way of spelling removal:

```ts
{ type: 'update', data: { bio: null }, where: { id: '1' } }
// bio holds null, and the key is still there
```

**To give an existing property the value `undefined`, use `set_property_undefined`.** The key stays present and its value becomes `undefined`:

```ts
{ type: 'set_property_undefined', path: 'nickname', where: { id: '1' } }
// { id: '1', nickname: undefined }  — 'nickname' in profile === true
```

**To remove a property outright, use `delete_property`.** The key goes away entirely:

```ts
{ type: 'delete_property', path: 'nickname', where: { id: '1' } }
// { id: '1' }  — 'nickname' in profile === false
```

Both verbs take a full path, so they reach properties inside nested objects — `'meta.badge'` steps into `meta`. A backslash escapes a dot that belongs to the key itself, so `'score\\.raw'` names one property called `score.raw`.

### Two details worth knowing

**The rejection is a runtime rule, not a type.** `data` keeps the plain row shape, so an explicit `undefined` compiles wherever the row type itself admits one. Excluding it structurally would break two things the payload type must do: a caller's own row-typed value could no longer be assigned directly, and a generic caller could no longer infer the row type from the payload at all. The runtime gate is the authority and rejects an explicit `undefined` at any depth, before anything is stored.

**The list-valued verbs make a deliberate exception, for keys only.** An item a `push` or `add_to_set` writes may hold an `undefined` **key**, because those items are compared by deep equality, which reads an absent key and an `undefined` one as the same thing — nothing about the item changes when it crosses a JSON boundary, so there is nothing to protect it from.

An `undefined` **element** is refused, in the same list. A list has no absent positions, so `JSON.stringify` cannot drop one and writes `null` instead:

```ts
JSON.stringify([undefined]);   // '[null]'
```

The list would then hold a value it never held — one the row schema may refuse on reload, and one that deep equality counts as already present next to an existing `null` where the `undefined` did not. Leave the element out of the list, or write `null` if that is the value you mean.

## Which one do I want?

The two verbs differ only inside a running JavaScript process, where the row is still a live object:

```ts
'nickname' in row          // true after set_property_undefined, false after delete_property
Object.keys(row)           // includes 'nickname' after set_property_undefined
```

Nothing else can tell them apart. `$exists` filters read both states as absent, deep equality treats a present-`undefined` key as a missing one, and serialising the item erases the key:

```ts
JSON.parse(JSON.stringify({ id: '1', nickname: undefined }));   // { id: '1' }
```

So if the data lives anywhere beyond the current process — a database, a file, another machine — `delete_property` is the honest verb, because that is the state the data will be in either way. Reach for `set_property_undefined` when the distinction genuinely matters to code holding the object in memory.

## What the verbs will not do

Both verbs alter properties that already exist and never build structure, so these are quiet successes that write nothing:

- the property's key is already absent;
- an object along the path is missing (`'meta.badge'` on a row with no `meta` — `meta` is not conjured into existence).

These, by contrast, are refused as `invalid_property_path`: the action fails, unrecoverably, and nothing is written.

- **A property the schema requires.** `set_property_undefined` needs a property whose schema accepts `undefined` as a value; `delete_property` needs one whose schema accepts the key being absent. A required field is neither.
- **A property holding an array of objects.** Removing the array wholesale raises the same reconciliation problems as replacing it, which is why an `update` cannot set one either. Edit the elements with `array_scope`, or empty the array with `pull`.
- **The primary key.** A row without its key cannot be found again.

# Building

- `npm run build_release` Will run the lint (failing if it gives any warnings), build it, and deploy with np

## Doing it in stages

- `npm run pkglint` ensures the code and package set up is optimal
- `npm run build` generates the package in ./dist (which package.json tells NPM about in fields such as 'export')
- `np` updates the package version, checks everything is OK, and tags it as a git release for NPM, and pushes to NPM. 

# FAQ

## Want to use GitHub Actions to publish to NPM? 

- Change `np` to prevent auto publishing, by using the `--no-publish` flag (see https://github.com/sindresorhus/np)
- Set up a GitHub Action (see https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages)


# Troubleshooting

## "You do not have permission to publish" / "You do not have write permissions required to publish this package."

If the message comes from `np`, run `npm publish` for a more detailed error message.

There are a few reasons:
- Are you logged in? Run `npm whoami` (and `npm login` if needed)
- Did you verify the email address for your NPM account?
- Is it a duplicate package name? If so, consider scoping 
