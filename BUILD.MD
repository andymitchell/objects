# Publishing to GitHub Packages

Official docs: https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry

## 1. Get a GitHub Personal Access Token (classic)

GitHub Packages requires a **classic** PAT (not fine-grained). GitHub itself recommends classic tokens for Packages.

1. Go to **GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic)**.
   Direct link: https://github.com/settings/tokens
2. Click **Generate new token (classic)**.
3. Give it a descriptive name (e.g. "GitHub Packages").
4. Select scopes:
   - `repo` — required by `np` to create tags and releases
   - `write:packages` — to publish packages
   - `delete:packages` — (optional) to delete packages
5. Click **Generate token** and copy it immediately. GitHub won't show it again.

## 2. Authenticate

Run this command, replacing `YOUR_TOKEN` with the PAT from step 1:

```bash
npm login --registry=https://npm.pkg.github.com --auth-type=legacy
```

When prompted, enter your GitHub username, paste the PAT as the password, and use your email.

### Alternative: store the token in `.npmrc`

You can add the token directly to the project's `.npmrc`:

```bash
echo "//npm.pkg.github.com/:_authToken=YOUR_TOKEN" >> .npmrc
```

> **Risk**: If `.npmrc` is accidentally committed, the token is exposed. The `.gitignore` in this repo excludes `.npmrc`, but double-check before committing. Using `npm login` (above) or an environment variable (below) is safer.

### Alternative: environment variable

Pass the token at publish time without storing it on disk:

```bash
NODE_AUTH_TOKEN=YOUR_TOKEN npm run build_release
```

## 3. Publish

```bash
npm run build_release
```

This runs `build_prepare` (build + publint) then launches `np`, which handles version bumping, git tagging, and publishing to the GitHub Packages registry configured in `package.json`.

## 4. Consuming this package in another project

In the consuming project, create a `.npmrc`:

```
@andymitchell:registry=https://npm.pkg.github.com
```

Then authenticate (same options as step 2 above — `npm login`, `.npmrc` token, or env var) and install:

```bash
npm install @andymitchell/objects
```

If the consuming user is not the package owner, grant them access via **GitHub > your profile > Packages tab > objects > Package settings > Manage access**.
