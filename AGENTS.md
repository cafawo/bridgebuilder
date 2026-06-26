# Agent Notes

- Use the `bridgebuilder` conda environment for all Python, local static server, test, and lint commands.
- Run commands with `conda run -n bridgebuilder ...`; do not rely on shell activation.
- Keep the frontend plain: root `index.html`, static files, vanilla JavaScript, and one HTML5 Canvas.
- Keep the game static-only; do not add any backend runtime for gameplay or level generation.
- Do not add pygame, Node, npm, React, Vue, bundlers, copied game assets, or the original executable.
- Keep the visual style close to the screenshots in `screenshots/`: dark grid, simple terrain, water, nodes, and straight beams.
