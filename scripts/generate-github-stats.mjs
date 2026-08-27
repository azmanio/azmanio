import fs from "node:fs/promises";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const GITHUB_USERNAME = "azmanio";
const OUTPUT_DIR = "profile";

const token = process.env.GH_STATS_TOKEN;

if (!token) {
	throw new Error(
		"GH_STATS_TOKEN tidak ditemukan. Pastikan secret sudah tersedia di GitHub Actions."
	);
}

/**
 * Membuat rentang tanggal maksimal 1 tahun.
 *
 * GitHub GraphQL ContributionsCollection tidak menerima
 * rentang waktu lebih dari 1 tahun.
 */
function getLastYearRange() {
	const to = new Date();
	const from = new Date(to);

	from.setUTCFullYear(from.getUTCFullYear() - 1);

	return {
		from: from.toISOString(),
		to: to.toISOString(),
	};
}

/**
 * Escape karakter khusus XML agar aman digunakan
 * di dalam SVG.
 */
function escapeXml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

/**
 * Format angka menggunakan separator.
 *
 * Contoh:
 * 1163 -> 1,163
 */
function formatNumber(value) {
	return new Intl.NumberFormat("en-US").format(value);
}

/**
 * Menjalankan request GraphQL ke GitHub.
 */
async function fetchGraphQL(query, variables) {
	const response = await fetch(GITHUB_GRAPHQL_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/vnd.github+json",
		},
		body: JSON.stringify({
			query,
			variables,
		}),
	});

	if (!response.ok) {
		const body = await response.text();

		throw new Error(
			`GitHub GraphQL request gagal: ${response.status} ${response.statusText}\n${body}`
		);
	}

	const payload = await response.json();

	if (payload.errors?.length) {
		console.error(
			"GitHub GraphQL errors:",
			JSON.stringify(payload.errors, null, 2)
		);

		throw new Error("GitHub GraphQL mengembalikan error.");
	}

	return payload.data;
}

/**
 * Query utama untuk mengambil data contribution.
 */
function buildQuery() {
	return `
		query (
			$login: String!,
			$from: DateTime!,
			$to: DateTime!
		) {
			user(login: $login) {
				login
				name

				contributionsCollection(
					from: $from,
					to: $to
				) {
					totalCommitContributions
					totalIssueContributions
					totalPullRequestContributions
					totalPullRequestReviewContributions
					totalRepositoriesWithContributedCommits
					totalRepositoryContributions

					restrictedContributionsCount
					hasAnyRestrictedContributions

					contributionCalendar {
						totalContributions
						weeks {
							contributionDays {
								date
								contributionCount
								weekday
								color
							}
						}
					}
				}
			}
		}
	`;
}

/**
 * Membuat stats.svg.
 */
function createStatsSvg(user) {
	const collection = user.contributionsCollection;

	const statistics = [
		{
			label: "Contributions",
			value: collection.contributionCalendar.totalContributions,
		},
		{
			label: "Commits",
			value: collection.totalCommitContributions,
		},
		{
			label: "Pull Requests",
			value: collection.totalPullRequestContributions,
		},
		{
			label: "Issues",
			value: collection.totalIssueContributions,
		},
		{
			label: "Reviews",
			value: collection.totalPullRequestReviewContributions,
		},
	];

	const startX = 32;
	const cardWidth = 150;
	const cardGap = 10;

	const cards = statistics
		.map((item, index) => {
			const x = startX + index * (cardWidth + cardGap);

			return `
				<g transform="translate(${x}, 52)">
					<text
						x="0"
						y="0"
						fill="#8b949e"
						font-size="12"
						font-family="Inter, Arial, sans-serif"
					>
						${escapeXml(item.label)}
					</text>

					<text
						x="0"
						y="34"
						fill="#f0f6fc"
						font-size="25"
						font-weight="700"
						font-family="Inter, Arial, sans-serif"
					>
						${formatNumber(item.value)}
					</text>
				</g>
			`;
		})
		.join("\n");

	const restrictedText = collection.hasAnyRestrictedContributions
		? `
			<text
				x="32"
				y="132"
				fill="#8b949e"
				font-size="10"
				font-family="Inter, Arial, sans-serif"
			>
				Includes private/internal contribution activity
			</text>
		`
		: "";

	return `
<svg
	xmlns="http://www.w3.org/2000/svg"
	width="820"
	height="160"
	viewBox="0 0 820 160"
	role="img"
	aria-label="GitHub statistics for ${escapeXml(
		user.name || user.login
	)}"
>
	<rect
		x="0.5"
		y="0.5"
		width="819"
		height="159"
		rx="14"
		fill="#161b22"
		stroke="#30363d"
	/>

	<text
		x="32"
		y="27"
		fill="#58a6ff"
		font-size="14"
		font-weight="600"
		font-family="Inter, Arial, sans-serif"
	>
		${escapeXml(user.name || user.login)} · GitHub Activity
	</text>

	${cards}

	${restrictedText}
</svg>
	`.trim();
}

/**
 * Membuat contribution calendar SVG.
 */
function createContributionsSvg(user) {
	const collection = user.contributionsCollection;
	const calendar = collection.contributionCalendar;

	const days = calendar.weeks.flatMap(
		(week) => week.contributionDays
	);

	const squareSize = 11;
	const gap = 3;

	const left = 32;
	const top = 45;

	const width = 820;
	const height = 175;

	const contributionCells = days
		.map((day, index) => {
			const weekIndex = Math.floor(index / 7);
			const dayIndex = day.weekday;

			const x = left + weekIndex * (squareSize + gap);
			const y = top + dayIndex * (squareSize + gap);

			const contributionCount = escapeXml(
				day.contributionCount
			);

			const date = escapeXml(day.date);

			return `
				<rect
					x="${x}"
					y="${y}"
					width="${squareSize}"
					height="${squareSize}"
					rx="2"
					fill="${day.color}"
				>
					<title>${date}: ${contributionCount} contributions</title>
				</rect>
			`;
		})
		.join("\n");

	return `
<svg
	xmlns="http://www.w3.org/2000/svg"
	width="${width}"
	height="${height}"
	viewBox="0 0 ${width} ${height}"
	role="img"
	aria-label="GitHub contribution activity"
>
	<rect
		x="0.5"
		y="0.5"
		width="${width - 1}"
		height="${height - 1}"
		rx="14"
		fill="#161b22"
		stroke="#30363d"
	/>

	<text
		x="32"
		y="25"
		fill="#f0f6fc"
		font-size="14"
		font-weight="600"
		font-family="Inter, Arial, sans-serif"
	>
		Contribution Activity · ${formatNumber(
			calendar.totalContributions
		)} contributions
	</text>

	${contributionCells}

	<text
		x="32"
		y="160"
		fill="#8b949e"
		font-size="10"
		font-family="Inter, Arial, sans-serif"
	>
		${escapeXml(
			collection.hasAnyRestrictedContributions
				? "Private/internal contribution activity is included."
				: "GitHub contribution activity for the last year."
		)}
	</text>
</svg>
	`.trim();
}

/**
 * Menulis file SVG ke filesystem.
 */
async function writeFile(filePath, content) {
	await fs.writeFile(filePath, content, "utf8");

	console.log(`Generated: ${filePath}`);
}

/**
 * Main application.
 */
async function main() {
	const { from, to } = getLastYearRange();

	console.log(
		`Fetching GitHub activity for ${GITHUB_USERNAME}...`
	);

	console.log(`Period: ${from} → ${to}`);

	const query = buildQuery();

	const data = await fetchGraphQL(query, {
		login: GITHUB_USERNAME,
		from,
		to,
	});

	const user = data?.user;

	if (!user) {
		throw new Error(
			`GitHub user '${GITHUB_USERNAME}' tidak ditemukan.`
		);
	}

	const collection = user.contributionsCollection;

	const stats = {
		contributions:
			collection.contributionCalendar.totalContributions,

		commits:
			collection.totalCommitContributions,

		pullRequests:
			collection.totalPullRequestContributions,

		issues:
			collection.totalIssueContributions,

		reviews:
			collection.totalPullRequestReviewContributions,

		repositories:
			collection.totalRepositoriesWithContributedCommits,

		restricted:
			collection.restrictedContributionsCount,

		hasRestricted:
			collection.hasAnyRestrictedContributions,
	};

	console.log("\nGitHub Contribution Summary");
	console.log("--------------------------------");
	console.log(
		`Total Contributions : ${formatNumber(
			stats.contributions
		)}`
	);
	console.log(
		`Total Commits       : ${formatNumber(stats.commits)}`
	);
	console.log(
		`Pull Requests       : ${formatNumber(
			stats.pullRequests
		)}`
	);
	console.log(
		`Issues              : ${formatNumber(stats.issues)}`
	);
	console.log(
		`Reviews             : ${formatNumber(stats.reviews)}`
	);
	console.log(
		`Repositories        : ${formatNumber(
			stats.repositories
		)}`
	);
	console.log(
		`Restricted          : ${formatNumber(stats.restricted)}`
	);
	console.log(
		`Has Restricted      : ${stats.hasRestricted}`
	);
	console.log("--------------------------------\n");

	await fs.mkdir(OUTPUT_DIR, {
		recursive: true,
	});

	const statsSvg = createStatsSvg(user);
	const contributionsSvg = createContributionsSvg(user);

	await writeFile(
		`${OUTPUT_DIR}/stats.svg`,
		statsSvg
	);

	await writeFile(
		`${OUTPUT_DIR}/contributions.svg`,
		contributionsSvg
	);

	console.log("\nGitHub statistics generated successfully.");
}

main().catch((error) => {
	console.error("\nFailed to generate GitHub statistics.");
	console.error(error);
	process.exit(1);
});
