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
