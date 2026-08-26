/**
 * GitHubClient — atomic file operations via GitHub Contents API.
 *
 * Provides SHA-checked PUT for optimistic concurrency control.
 * Both news-monster and music-shorts use this to coordinate
 * on the same channel-state.json without race conditions.
 */

export class GitHubClient {
  constructor(options = {}) {
    this.owner = options.owner || 'sham435';
    this.repo = options.repo || 'youtube-channel-control';
    this.token = options.token || process.env.GITHUB_TOKEN || process.env.GH_PAT || '';
    this.base = `https://api.github.com/repos/${this.owner}/${this.repo}/contents`;
  }

  async request(url, options = {}) {
    const headers = {
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {}),
      ...options.headers,
    };
    const res = await fetch(url, { ...options, headers });
    return res;
  }

  /**
   * Read a file. Returns { content, sha }.
   * sha is required for subsequent PUT (optimistic concurrency).
   */
  async read(filePath) {
    const res = await this.request(`${this.base}/${filePath}`);
    if (!res.ok) {
      const body = await res.text();
      throw new GitHubError(`READ ${filePath} failed: ${res.status}`, res.status, body);
    }
    const data = await res.json();
    return {
      content: JSON.parse(Buffer.from(data.content, 'base64').toString('utf-8')),
      sha: data.sha,
    };
  }

  /**
   * Write a file with SHA check (optimistic concurrency).
   * Returns { sha, ok: true } on success.
   * Throws GitHubConflictError on 409 (SHA mismatch — someone else wrote first).
   */
  async write(filePath, content, sha, message) {
    const body = {
      message,
      content: Buffer.from(JSON.stringify(content, null, 2)).toString('base64'),
      sha,
    };
    const res = await this.request(`${this.base}/${filePath}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 409) {
      throw new GitHubConflictError(filePath, sha);
    }
    if (!res.ok) {
      const text = await res.text();
      throw new GitHubError(`WRITE ${filePath} failed: ${res.status}`, res.status, text);
    }
    const data = await res.json();
    return { sha: data.content.sha, ok: true };
  }

  /**
   * Read-modify-write with automatic retry on conflict.
   * fn(state) must return the modified state.
   * Retries up to `retries` times on 409.
   */
  async atomicUpdate(filePath, fn, message, retries = 5) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const { content, sha } = await this.read(filePath);
        const updated = fn(content);
        const result = await this.write(filePath, updated, sha, message);
        return { ...result, attempts: attempt + 1 };
      } catch (err) {
        if (err instanceof GitHubConflictError) {
          lastError = err;
          // Brief backoff before retry
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
    throw new GitHubError(
      `atomicUpdate ${filePath} failed after ${retries} retries (last: ${lastError?.message})`,
      409
    );
  }
}

export class GitHubError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.body = body;
  }
}

export class GitHubConflictError extends GitHubError {
  constructor(filePath, expectedSha) {
    super(`Conflict on ${filePath}: SHA ${expectedSha} is stale`, 409);
    this.name = 'GitHubConflictError';
    this.filePath = filePath;
    this.expectedSha = expectedSha;
  }
}
