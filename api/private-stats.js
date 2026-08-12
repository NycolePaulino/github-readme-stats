const GITHUB_API = "https://api.github.com";

const githubHeaders = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${process.env.PAT_1}`,
  "X-GitHub-Api-Version": "2026-03-10",
};

async function githubRequest(url) {
  const response = await fetch(url, {
    headers: githubHeaders,
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `GitHub API ${response.status}: ${body.slice(0, 300)}`
    );
  }

  return response;
}
 function getAuthenticatedUser() {
  const response = await githubRequest(`${GITHUB_API}/user`);

  return response.json();
}


async function getRepositories() {
  const repositories = [];

  let page = 1;

  while (true) {
    const url =
      `${GITHUB_API}/user/repos` +
      `?visibility=all` +
      `&affiliation=owner,collaborator,organization_member` +
      `&per_page=100` +
      `&page=${page}` +
      `&sort=updated`;

    const response = await githubRequest(url);
    const data = await response.json();

    repositories.push(...data);

    if (data.length < 100) {
      break;
    }

    page++;
  }

  return repositories;
}


async function getCommitCount({
  owner,
  repo,
  username,
  since,
  until,
}) {
  const params = new URLSearchParams({
    author: username,
    since,
    until,
    per_page: "1",
  });

  const url =
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}` +
    `/${encodeURIComponent(repo)}/commits?${params}`;

  const response = await fetch(url, {
    headers: githubHeaders,
  });


  if (response.status === 404 || response.status === 409) {
    return 0;
  }

  if (!response.ok) {
    const body = await response.text();

    throw new Error(
      `GitHub commits API ${response.status}: ${body.slice(0, 300)}`
    );
  }

  const commits = await response.json();

  if (commits.length === 0) {
    return 0;
  }

  const linkHeader = response.headers.get("link");


  if (!linkHeader) {
    return commits.length;
  }


  const lastPageMatch = linkHeader.match(
    /[?&]page=(\d+)>;\s*rel="last"/
  );

  if (lastPageMatch) {
    return Number(lastPageMatch[1]);
  }

  return commits.length;
}

async function processInBatches(items, batchSize, callback) {
  const results = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(callback)
    );

    results.push(...batchResults);
  }

  return results;
}


function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function createSvg({
  commits,
  repositories,
  startDate,
  endDate,
}) {
  const width = 720;
  const height = 250;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg
  width="${width}"
  height="${height}"
  viewBox="0 0 ${width} ${height}"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
>
  <defs>
    <linearGradient
      id="background"
      x1="0"
      y1="0"
      x2="${width}"
      y2="${height}"
      gradientUnits="userSpaceOnUse"
    >
      <stop stop-color="#161B22"/>
      <stop offset="1" stop-color="#0D1117"/>
    </linearGradient>
  </defs>

  <rect
    width="${width}"
    height="${height}"
    rx="14"
    fill="url(#background)"
    stroke="#30363D"
  />

  <!-- Título -->

  <text
    x="40"
    y="48"
    fill="#F0F6FC"
    font-family="Arial, Helvetica, sans-serif"
    font-size="22"
    font-weight="700"
  >
    Atividade no GitHub
  </text>

  <text
    x="40"
    y="75"
    fill="#8B949E"
    font-family="Arial, Helvetica, sans-serif"
    font-size="13"
  >
    Últimos 12 meses
  </text>

  <!-- Separador -->

  <line
    x1="40"
    y1="94"
    x2="680"
    y2="94"
    stroke="#30363D"
  />

  <!-- Commits -->

  <text
    x="70"
    y="145"
    fill="#8B5CF6"
    font-family="Arial, Helvetica, sans-serif"
    font-size="38"
    font-weight="700"
  >
    ${formatNumber(commits)}
  </text>

  <text
    x="70"
    y="173"
    fill="#8B949E"
    font-family="Arial, Helvetica, sans-serif"
    font-size="14"
  >
    commits
  </text>

  <!-- Repositórios -->

  <text
    x="400"
    y="145"
    fill="#8B5CF6"
    font-family="Arial, Helvetica, sans-serif"
    font-size="38"
    font-weight="700"
  >
    ${formatNumber(repositories)}
  </text>

  <text
    x="400"
    y="173"
    fill="#8B949E"
    font-family="Arial, Helvetica, sans-serif"
    font-size="14"
  >
    repositórios com atividade
  </text>

  <!-- Período -->

  <text
    x="40"
    y="215"
    fill="#6E7681"
    font-family="Arial, Helvetica, sans-serif"
    font-size="12"
  >
    ${escapeXml(startDate)} → ${escapeXml(endDate)}
  </text>

  <text
    x="680"
    y="215"
    text-anchor="end"
    fill="#6E7681"
    font-family="Arial, Helvetica, sans-serif"
    font-size="12"
  >
    NycolePaulino
  </text>

</svg>`;
}

export default async function handler(req, res) {
  try {
    if (!process.env.PAT_1) {
      return res.status(500).send(
        "PAT_1 não está configurado na Vercel."
      );
    }


    const authenticatedUser = await getAuthenticatedUser();

    const username = authenticatedUser.login;


    const end = new Date();

    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 365);

    const since = start.toISOString();
    const until = end.toISOString();


    const repositories = await getRepositories();

    const results = await processInBatches(
      repositories,
      5,
      async (repository) => {
        try {
          const owner =
            repository.owner?.login;

          if (!owner) {
            return 0;
          }

          return await getCommitCount({
            owner,
            repo: repository.name,
            username,
            since,
            until,
          });
        } catch (error) {
          console.error(
            `Erro no repositório ${repository.full_name}:`,
            error.message
          );

          return 0;
        }
      }
    );


    const totalCommits = results.reduce(
      (total, commits) => total + commits,
      0
    );


    const activeRepositories = results.filter(
      (commits) => commits > 0
    ).length;

    const startDate = start.toLocaleDateString(
      "pt-BR",
      {
        timeZone: "UTC",
      }
    );

    const endDate = end.toLocaleDateString(
      "pt-BR",
      {
        timeZone: "UTC",
      }
    );


    const svg = createSvg({
      commits: totalCommits,
      repositories: activeRepositories,
      startDate,
      endDate,
    });


    res.setHeader(
      "Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=86400"
    );

    res.setHeader(
      "Content-Type",
      "image/svg+xml; charset=utf-8"
    );

    return res.status(200).send(svg);
  } catch (error) {
    console.error(error);

    return res.status(500).send(
      `Erro ao gerar estatísticas: ${error.message}`
    );
  }
}
