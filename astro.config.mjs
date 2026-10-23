// @ts-check

import { rm } from 'node:fs/promises';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

/**
 * ADR-018: the same app can also be built as plain files for the static site
 * (S3 + CloudFront). `npm run build:static` sets SITE_MODE=static. The game
 * runs in the browser, so only the /api endpoints need a server; they are
 * removed from the static build rather than frozen into misleading files.
 */
const staticSite = process.env.SITE_MODE === 'static';

/** @type {import('astro').AstroIntegration} */
const dropApiFromStaticBuild = {
	name: 'drop-api-from-static-build',
	hooks: {
		'astro:build:done': async ({ dir }) => {
			await rm(new URL('api/', dir), { recursive: true, force: true });
		},
	},
};

// https://astro.build/config
export default defineConfig({
	site: 'https://example.com',
	// Server-rendered on the Node adapter so the app can expose /api/health and log
	// requests (see docs/adr/ADR-001). Packaged by the Dockerfile.
	output: staticSite ? 'static' : 'server',
	...(staticSite ? {} : { adapter: node({ mode: 'standalone' }) }),
	integrations: staticSite ? [sitemap(), dropApiFromStaticBuild] : [sitemap()],
	// Lets the browser code know there is no server to report errors to.
	vite: { define: { 'import.meta.env.PUBLIC_STATIC_SITE': JSON.stringify(staticSite) } },
	// Self-hosted (OFL licences in src/assets/fonts). No third-party font CDN.
	fonts: [
		{
			provider: fontProviders.local(),
			name: 'Alegreya',
			cssVariable: '--font-display',
			fallbacks: ['Georgia', 'serif'],
			options: {
				variants: [
					{ src: ['./src/assets/fonts/alegreya-latin-500-normal.woff2'], weight: 500, style: 'normal', display: 'swap' },
					{ src: ['./src/assets/fonts/alegreya-latin-700-normal.woff2'], weight: 700, style: 'normal', display: 'swap' },
				],
			},
		},
		{
			provider: fontProviders.local(),
			name: 'Alegreya Sans',
			cssVariable: '--font-ui',
			fallbacks: ['system-ui', 'sans-serif'],
			options: {
				variants: [
					{ src: ['./src/assets/fonts/alegreya-sans-latin-400-normal.woff2'], weight: 400, style: 'normal', display: 'swap' },
					{ src: ['./src/assets/fonts/alegreya-sans-latin-500-normal.woff2'], weight: 500, style: 'normal', display: 'swap' },
					{ src: ['./src/assets/fonts/alegreya-sans-latin-700-normal.woff2'], weight: 700, style: 'normal', display: 'swap' },
				],
			},
		},
	],
});
