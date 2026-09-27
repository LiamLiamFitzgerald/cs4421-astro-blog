import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	// Load Markdown and MDX files in the `src/content/blog/` directory.
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			// Transform string to Date object
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			heroImage: z.optional(image()),
			author: reference('authors').optional(),
		}),
});

const authors = defineCollection({
	// Load author profiles from the `src/content/authors/` directory.
	loader: glob({ base: './src/content/authors', pattern: '**/*.md' }),
	// Type-check frontmatter using a schema
	schema: ({ image }) =>
		z.object({
			name: z.string(),
			avatar: image(),
			bio: z.string(),
			socialLinks: z
				.array(
					z.object({
						label: z.string(),
						url: z.string().url(),
					}),
				)
				.default([]),
		}),
});

export const collections = { blog, authors };
