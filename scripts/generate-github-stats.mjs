import fs from "node:fs/promises";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";

const username = "azmanio";
const token = process.env.GH_STATS_TOKEN;

if (!token) {
  throw new Error("GH_STATS_TOKEN is not set.");
}

const currentYear = new Date().getUTCFullYear();
const from = `${currentYear - 1}-01-01T00:00:00Z`;
const to = new Date().toISOString();

const query = `
  query($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      login
      name

      contributionsCollection(from: $from, to: $to) {
        totalCommitContributions
        totalIssueContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalRepositoriesWithContributedCommits
        totalRepositoriesWithContributedIssues
        totalRepositoriesWithContributedPullRequests
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

async function fetchGraphQL() {
  const response = await fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      query,
      variables: {
        login: username,
        from,
        to,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub GraphQL request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    console.error(JSON.stringify(payload.errors, null, 2));
    throw new Error("GitHub GraphQL returned errors.");
  }

  return payload.data.user;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function createStatsSvg(user) {
  const contributions = user.contributionsCollection;

  const stats = [
    {
      label: "Contributions",
      value: contributions.contributionCalendar.totalContributions,
    },
    {
      label: "Commits",
      value: contributions.totalCommitContributions,
    },
    {
      label: "Pull Requests",
      value: contributions.totalPullRequestContributions,
    },
    {
      label: "Issues",
      value: contributions.totalIssueContributions,
    },
    {
      label: "Reviews",
      value: contributions.totalPullRequestReviewContributions,
    },
  ];

  const cards = stats.map((item, index) => {
    const x = 40 + index * 150;

    return `
      <g transform="translate(${x}, 40)">
        <text
          x="0"
          y="0"
          fill="#94a3b8"
          font-size="12"
          font-family="Inter, Arial, sans-serif"
        >
          ${escapeXml(item.label)}
        </text>

        <text
          x="0"
          y="34"
          fill="#f8fafc"
          font-size="26"
          font-weight="700"
          font-family="Inter, Arial, sans-serif"
        >
          ${formatNumber(item.value)}
        </text>
      </g>
    `;
  });

  const restricted = contributions.restrictedContributionsCount;

  return `
<svg
  width="820"
  height="150"
  viewBox="0 0 820 150"
  xmlns="http://www.w3.org/2000/svg"
>
  <rect
    x="0.5"
    y="0.5"
    width="819"
    height="149"
    rx="16"
    fill="#161b22"
    stroke="#30363d"
  />

  <text
    x="40"
    y="24"
    fill="#58a6ff"
    font-size="14"
    font-weight="600"
    font-family="Inter, Arial, sans-serif"
  >
    ${escapeXml(user.name || user.login)} · GitHub Activity
  </text>

  ${cards.join("\n")}

  ${
    restricted > 0
      ? `
    <text
      x="40"
      y="128"
      fill="#8b949e"
      font-size="11"
      font-family="Inter, Arial, sans-serif"
    >
      Includes private/internal contribution activity
    </text>
  `
      : ""
  }
</svg>
  `.trim();
}

function createContributionSvg(user) {
  const calendar =
    user.contributionsCollection.contributionCalendar;

  const days = calendar.weeks.flatMap((week) => week.contributionDays);

  const squareSize = 11;
  const gap = 3;
  const left = 50;
  const top = 35;

  const width = 820;
  const height = 180;

  const rects = days.map((day, index) => {
    const weekIndex = Math.floor(index / 7);
    const dayIndex = day.weekday;

    const x = left + weekIndex * (squareSize + gap);
    const y = top + dayIndex * (squareSize + gap);

    return `
      <rect
        x="${x}"
        y="${y}"
        width="${squareSize}"
        height="${squareSize}"
        rx="2"
        fill="${day.color}"
      >
        <title>
          ${escapeXml(day.date)}: ${day.contributionCount} contributions
        </title>
      </rect>
    `;
  });

  return `
<svg
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
  xmlns="http://www.w3.org/2000/svg"
>
  <rect
    x="0.5"
    y="0.5"
    width="${width - 1}"
    height="${height - 1}"
    rx="16"
    fill="#161b22"
    stroke="#30363d"
  />

  <text
    x="30"
    y="24"
    fill="#f0f6fc"
    font-size="14"
    font-weight="600"
    font-family="Inter, Arial, sans-serif"
  >
    Contribution Activity · ${formatNumber(calendar.totalContributions)} total
  </text>

  ${rects.join("\n")}
</svg>
  `.trim();
}

async function main() {
  console.log(`Fetching GitHub activity for ${username}...`);

  const user = await fetchGraphQL();

  if (!user) {
    throw new Error(`GitHub user '${username}' was not found.`);
  }

  const statsSvg = createStatsSvg(user);
  const contributionsSvg = createContributionSvg(user);

  await fs.mkdir("profile", { recursive: true });

  await fs.writeFile(
    "profile/stats.svg",
    statsSvg,
    "utf8"
  );

  await fs.writeFile(
    "profile/contributions.svg",
    contributionsSvg,
    "utf8"
  );

  const collection = user.contributionsCollection;

  console.log("Generated:");
  console.log(" - profile/stats.svg");
  console.log(" - profile/contributions.svg");

  console.log({
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
    restricted:
      collection.restrictedContributionsCount,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
