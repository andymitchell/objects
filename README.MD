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

# History

The build process was heavily inspired by https://mikeesto.com/posts/publishing-npm-package/. Notably: 
- tsup builds commonjs and esm modules into ./dist, using the config in `npm run build`
- `npm run pkglint` runs the linter for the Npm Package, to give suggestions that ensure max compatibility. See https://publint.dev. 
- Opted to use https://github.com/sindresorhus/np to build a publishable release. 

https://github.com/frehner/modern-guide-to-packaging-js-library is a very helpful resource for understanding the options. 

I switched from 'objects' to a scoped package, @andyrmitchell/objects
- Note my GitHub is @andymitchell, but NPM is @andyrmitchell (r in the middle). It has to be andyrmitchell for permission on NPM. 
- When you scope something by changing the name to use @, it switches to publishing privately. 
    - Therefore in package.json I set `publishConfig.access` to 'public' 