export function buildDefaultSubmitRepo(
  owner: string,
  projectName: string,
  date: Date = new Date(),
) {
  const username = owner.trim();
  if (!username) return '';
  return `${username}/${slugifyRepoName(projectName)}-${formatRepoDate(date)}`;
}

export function extractGitHubRepoPath(repoUrl: string) {
  const trimmed = repoUrl.trim();
  if (!trimmed) return '';

  const normalized = trimmed.replace(/\.git$/i, '');
  const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)\/?$/i);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/([^/?#]+)\/?$/i);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  return '';
}

export function formatRepoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

export function slugifyRepoName(name: string) {
  return (
    name
      .trim()
      .replace(/[^\x00-\x7F]+/g, '')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]|[-.]$/g, '') || 'project'
  );
}
