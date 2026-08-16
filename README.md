# Clock Definition Workbench

Clock Definition Workbench parses and executes CLK definition files and displays the resulting 32-bit output as an output sequence and waveform. It targets current versions of Chrome and Firefox.

## Features

- CLK definition editing, file loading, and diagnostics
- Instruction execution with a configurable step limit
- Output sequence and per-bit waveform views
- Tick-based zoom, range selection, and full-width display
- Aggregation of consecutive single-word pattern outputs
- One-shot non-output commands attached to waveform event pins

## Project layout

- `app/`: self-contained Vite project root
- `app/src/`: React application source code
- `app/public/`: static assets copied into the build
- `site/`: generated static website for GitHub Pages
- `.github/workflows/build.yml`: push-triggered validation build
- `.github/workflows/pages.yml`: GitHub Pages deployment workflow

The generated `site/` directory is not committed. GitHub Actions builds it and uploads it as the Pages artifact.

## Requirements

- Node.js 22.13.0 or later

## Development

```bash
cd app
npm ci
npm run dev
```

## Build

```bash
cd app
npm ci
npm run build
```

The static website is generated in the repository-level `site/` directory.

To build with the GitHub Pages project path locally:

```bash
cd app
BASE_PATH=/clk_workbench/ npm run build
```

## Test

```bash
cd app
npm test
```

## Formatting

Format the source files:

```bash
cd app
npm run format
```

Check formatting without modifying files:

```bash
cd app
npm run format:check
```

## GitHub Pages

After the repository becomes public, enable GitHub Pages with **GitHub Actions** as its source and run the **Deploy GitHub Pages** workflow. Subsequent workflow runs build the application with `/clk_workbench/` as its base path and deploy the generated `site/` directory.

## License

Clock Definition Workbench is released under the MIT License. See [LICENSE](LICENSE).

Licenses for software included in the distributed bundle are listed in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
