# Building

- `npm run pkglint` ensures the code and package set up is optimal
- `npm run build` generates the package in ./dist (which package.json tells NPM about)

# History

The build process was heavily inspired by https://mikeesto.com/posts/publishing-npm-package/. Notably: 
- tsup builds commonjs and esm modules into ./dist, using the config in `npm run build`
- `npm run pkglint` runs the linter for the Npm Package, to give suggestions that ensure max compatibility. See https://publint.dev. 

https://github.com/frehner/modern-guide-to-packaging-js-library is a very helpful resource for understanding the options. 