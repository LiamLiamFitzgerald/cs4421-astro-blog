// Site-wide names and links, defined once.

export const SITE_TITLE = 'Catan Tracker';
export const SITE_DESCRIPTION =
	'Deal a fair Catan board and keep score for 2 to 6 players. Built to practise DevOps on a real codebase.';
export const REPO_URL = 'https://github.com/LiamLiamFitzgerald/cs4421-astro-blog';
export const AUTHOR = 'Liam Fitzgerald';

/** Primary navigation, in order. */
export const NAV = [
	{ href: '/', label: 'Home' },
	{ href: '/catan', label: 'Play' },
	{ href: '/rooms', label: 'Rooms' },
	{ href: '/about', label: 'About' },
] as const;
