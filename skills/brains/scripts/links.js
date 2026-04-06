#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const LINK_PATTERN = /\[\[([^\]]+)\]\]/g;

function findLinks(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const links = [];
  let match;
  while ((match = LINK_PATTERN.exec(content)) !== null) {
    links.push(match[1]);
  }
  return [...new Set(links)];
}

function findBacklinks(targetName, dirPath) {
  const entries = fs.readdirSync(dirPath, { recursive: true }).sort();
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry);
    if (fs.statSync(fullPath).isFile() && /\.(md|markdown)$/i.test(entry)) {
      const links = findLinks(fullPath);
      if (links.some(l => l.toLowerCase() === targetName.toLowerCase())) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

const args = process.argv.slice(2);
const backlinksMode = args.includes('--backlinks');
const filteredArgs = args.filter(a => a !== '--backlinks');

if (filteredArgs.length === 0) {
  console.error('Usage:');
  console.error('  links.js <file>              — show links from a file');
  console.error('  links.js --backlinks <name> <dir>  — find files that link to <name>');
  process.exit(1);
}

if (backlinksMode) {
  const targetName = filteredArgs[0];
  const dirPath = filteredArgs[1] || '.';
  const results = findBacklinks(targetName, dirPath);
  if (results.length === 0) {
    console.log(`No backlinks to "${targetName}" found.`);
  } else {
    console.log(`Files linking to "${targetName}":`);
    for (const r of results) {
      console.log(`  ${r}`);
    }
  }
} else {
  const filePath = filteredArgs[0];
  const links = findLinks(filePath);
  if (links.length === 0) {
    console.log('No links found.');
  } else {
    console.log(`Links in ${filePath}:`);
    for (const link of links) {
      console.log(`  [[${link}]]`);
    }
  }
}
