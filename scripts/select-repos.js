#!/usr/bin/env node
const fs = require('node:fs');

const distance = (a, b) => a.reduce((sum, value, i) => sum + (value - b[i]) ** 2, 0);

// Start with the most distant pair. Then maximize distance to the nearest selected repository.
function selectRepos(data, count) {
  const { axes, repos } = data;
  if (!Array.isArray(axes) || axes.length < 2 || new Set(axes).size !== axes.length ||
      axes.some((axis) => typeof axis !== 'string' || !axis.trim())) {
    throw new Error('Use at least two distinct axis names.');
  }
  if (!Array.isArray(repos) || repos.length < 2 || !Number.isInteger(count) || count < 2 || count > repos.length) {
    throw new Error('Select two or more repositories, up to the input count.');
  }
  const urls = new Set();
  for (const repo of repos) {
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/.test(repo.url || '')) {
      throw new Error('Use a GitHub repository URL without a final slash.');
    }
    const key = repo.url.toLowerCase().replace(/\.git$/, '');
    if (urls.has(key)) throw new Error('Use each repository once.');
    urls.add(key);
    if (!Array.isArray(repo.scores) || repo.scores.length !== axes.length ||
        repo.scores.some((score) => !Number.isFinite(score) || score < 0 || score > 10)) {
      throw new Error('Supply one score from 0 to 10 per axis for each repository.');
    }
  }
  const selected = [0, 1];
  let farthest = -1;
  for (let i = 0; i < repos.length; i++) for (let j = i + 1; j < repos.length; j++) {
    const d = distance(repos[i].scores, repos[j].scores);
    if (d > farthest) { farthest = d; selected[0] = i; selected[1] = j; }
  }
  while (selected.length < count) {
    let next = -1, best = -1;
    for (let i = 0; i < repos.length; i++) {
      if (selected.includes(i)) continue;
      const nearest = Math.min(...selected.map((j) => distance(repos[i].scores, repos[j].scores)));
      if (nearest > best) { best = nearest; next = i; }
    }
    selected.push(next);
  }
  let minimum = Infinity;
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) {
    minimum = Math.min(minimum, distance(repos[selected[i]].scores, repos[selected[j]].scores));
  }
  return { axes, repos: selected.map((i) => repos[i]), minimumDistance: Math.sqrt(minimum) };
}

if (require.main === module) {
  try {
    const [, , file, count] = process.argv;
    if (!file || !count || process.argv.length !== 4) throw new Error('Use: node scripts/select-repos.js <scores.json> <count>');
    console.log(JSON.stringify(selectRepos(JSON.parse(fs.readFileSync(file, 'utf8')), Number(count)), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { selectRepos };
