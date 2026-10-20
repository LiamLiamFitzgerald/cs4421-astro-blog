// @ts-check

import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://example.com',
	// Server-rendered on the Node adapter so the app can expose /api/health and log
	// requests (see docs/adr/ADR-001). Packaged by the Dockerfile.
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	integrations: [sitemap()],
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
