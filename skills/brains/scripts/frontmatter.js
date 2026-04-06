#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const recursive = process.argv.includes('-r');
const args = process.argv.slice(2).filter(a => a !== '-r');

if (args.length === 0) {
  console.error('Usage: frontmatter.js [-r] <path> [path2] ...');
  process.exit(1);
}

function extractFrontmatter(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  return match[1].trim();
}

function printFrontmatter(filePath) {
  const fm = extractFrontmatter(filePath);
  if (fm) {
    console.log(`--- ${filePath} ---`);
    console.log(fm);
    console.log();
  }
}

function processPath(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    printFrontmatter(targetPath);
  } else if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath, { recursive }).sort();
    for (const entry of entries) {
      const fullPath = path.join(targetPath, entry);
      if (fs.statSync(fullPath).isFile() && /\.(md|markdown)$/i.test(entry)) {
        printFrontmatter(fullPath);
      }
    }
  }
}

for (const arg of args) {
  processPath(arg);
}
