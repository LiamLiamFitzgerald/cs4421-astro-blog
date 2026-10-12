/**
 * Architecture rules (see docs/architecture.md and ADR-004).
 * Dependencies point inward: delivery -> app -> games/core. The domain code in
 * src/lib/core and src/lib/games knows nothing about Astro, storage or the DOM.
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: "domain-is-framework-free",
      comment:
        "Domain code (core, games) may not import npm packages, Node built-ins or Astro. Tests are exempt.",
      severity: "error",
      from: { path: "^src/lib/(core|games)/", pathNot: "\\.test\\.ts$" },
      to: { dependencyTypes: ["npm", "npm-dev", "npm-peer", "npm-optional", "core"] },
    },
    {
      name: "domain-does-not-depend-outward",
      comment: "Domain code may not import the app layer, adapters or delivery code.",
      severity: "error",
      from: { path: "^src/lib/(core|games)/" },
      to: { path: "^src/(lib/(app|adapters)|pages|components|layouts)/" },
    },
    {
      name: "app-does-not-depend-on-adapters-or-delivery",
      comment: "The app layer depends on ports (interfaces), never on adapters or pages.",
      severity: "error",
      from: { path: "^src/lib/app/" },
      to: { path: "^src/(lib/adapters|pages|components|layouts)/" },
    },
    {
      name: "adapters-do-not-depend-on-delivery",
      comment: "Adapters implement ports; they do not import pages or components.",
      severity: "error",
      from: { path: "^src/lib/adapters/" },
      to: { path: "^src/(pages|components|layouts)/" },
    },
    {
      name: "lib-does-not-depend-on-delivery",
      comment: "Nothing in src/lib may import pages, components or layouts.",
      severity: "error",
      from: { path: "^src/lib/" },
      to: { path: "^src/(pages|components|layouts)/" },
    },
    {
      name: "no-circular",
      comment: "Circular dependencies make code hard to change safely.",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      comment: "Modules nothing uses are probably dead code.",
      severity: "warn",
      from: {
        orphan: true,
        pathNot: ["\\.test\\.ts$", "\\.d\\.ts$", "(^|/)\\.[^/]+\\.(c?js|mjs)$"],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "^src/(content|assets|styles)/" },
  },
};
