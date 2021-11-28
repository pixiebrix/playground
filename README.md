# playground

> Playground for testing extensions and web customization.

Example pages available: 
* [Bootstrap 5 swatch](https://pixiebrix.github.io/playground/example/)
* [Create React App](https://pixiebrix.github.io/playground/react-example/): React 16.12.0, React Bootstrap 1.6.0

Repo available at [https://github.com/pixiebrix/playground](https://github.com/pixiebrix/playground)

## Adding an example page/project

1. Create a folder at the root of the repo:
   1. Ensure the public distribution folder contains an index.html file. (See `example/index.html` for reference) 
2. Add steps to the `.github/workflows/gh-pages.yaml` GitHub actions workflow:
   1. (As needed) Add a step to build the example project. For builds that produce URLs that are relative to a public URL, provide`/playground/YOUR_FOLDER_NAME/` as the base.
   2. Add a command to the "Create public distribution" step
3. Merge the changes into `main`. The GitHub workflow is set up to publish the site on each commit of main (by automatically copying the distribution files over to the `gh-pages` branch)
4. Access it at `https://pixiebrix.github.io/playground/YOUR_FOLDER_NAME/`
5. No rules at this point, but be careful about editing previous content (they might be being used in automated tests)
