# playground

> Playground for testing extensions and web customization.

Example pages available:

- [/bootstrap-5](https://pbx.vercel.app/bootstrap-5/): Bootstrap 5 swatch
- [/create-react-app](https://pbx.vercel.app/create-react-app/): React 16.12.0, React Bootstrap 1.6.0

## Contribute

Each folder is its own standalone project so we never have dependency conflicts.

_Some projects might be used for testing, it's often better to create a new project._

### Adding a static project

1. Create a folder in `static/`
1. Add at least an `index.html` file (like `static/my-demo/index.html`)
1. Access it at `https://pbx.vercel.app/my-demo/`

### Adding a project with a build

1. Create a folder in `source/` with the source files, like `source/my-demo/`
   - Treat this folder as a self-contained project with its own `package.json` file
1. Add the _install_ and _build_ steps in its own `build.sh` file (like `source/my-demo/build.sh`)
	- it should include the exact header as other build.sh scripts
	- it should output files in `public/`
3. Run build.sh on your computer, like `bash source/my-demo/build.sh`
4. Commit both `source` and `public` folders

1. If your project is a single-page APP (i.e. all paths point to index.html), you'll have to edit `vercel.json` too
1. Access it at `https://pbx.vercel.app/my-demo/`
   - If you send a PR, you can access a temporary deployment at a custom URL like `pbx-temp-pr.vercel.app/my-demo/`
