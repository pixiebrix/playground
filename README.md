# playground

> Playground for testing extensions and web customization.

Example pages available:

- [bootstrap-5](https://pbx.vercel.app/bootstrap-5/): Bootstrap 5 swatch
- [create-react-app](https://pbx.vercel.app/create-react-app/): React 16.12.0, React Bootstrap 1.6.0

Repo available at [https://github.com/pixiebrix/playground](https://github.com/pixiebrix/playground)

## Contribute

Each folder is its own standalone project so we never have dependency conflicts. The only shared part is `build.sh`, where you might have to add build steps.

_Some projects might be used for testing, it's often better to create a new project._

### Adding a static page/project

1. Create folder at the root of the repo, with at least an `index.html` file (like `/my-demo/index.html`)
1. Access it at `https://pbx.vercel.app/my-demo/`

### Adding a page/project with a build

1. Create folder at the root of the repo with the source files, like `/my-demo/`
   - Treat this folder as a self-contained project with its own `package.json` file
1. Add its _install_ and _build_ steps in its own `build.sh` file (like `/my-demo/build.sh`)
   - One of the step must create a directory under `/public`, like `public/my-demo/index.html`
   - Example:
      ```sh
      #! /bin/sh

      set -e # exit when any command fails

      yarn
      PUBLIC_URL=/my-demo/ yarn run build
      mv build ../public/my-demo
      ```

1. Access it at `https://pbx.vercel.app/my-demo/`
   - If you send a PR, you can access a temporary deployment at a custom URL like `pbx-temp-pr.vercel.app/my-demo/`
