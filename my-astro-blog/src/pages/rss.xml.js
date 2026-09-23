import { getCollection, getEntry } from 'astro:content';
import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';

export async function GET(context) {
	const posts = await getCollection('blog');
	const items = await Promise.all(
		posts.map(async (post) => {
			const { author, ...data } = post.data;
			const authorEntry = author ? await getEntry(author) : undefined;
			return {
				...data,
				author: authorEntry?.data.name,
				link: `/blog/${post.id}/`,
			};
		}),
	);
	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		items,
	});
}
