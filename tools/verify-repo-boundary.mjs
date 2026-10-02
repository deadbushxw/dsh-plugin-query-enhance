#!/usr/bin/env node
/**
 * Fails when the tracked file set would publish something it should not.
 *
 * This is the machine-checkable half of the repository boundary described in
 * README.md > "Repository boundary". Run it with `npm run verify-boundary`. It
 * scans every file git would publish and reports:
 *
 *   1. absolute local paths - a Windows drive path, a POSIX home directory, a
 *      macOS user directory. The README deliberately writes `%USERPROFILE%`
 *      instead, so any concrete path is a leak of somebody's machine;
 *   2. credential-shaped text (private keys, common token prefixes, secret
 *      assignments);
 *   3. runtime state and generated artefacts that should never be committed;
 *   4. unexpectedly large files.
 *
 * It checks for the *shape* of a local path rather than for the names of one
 * particular machine. That keeps this file free of the very data it defends
 * against: there is no username, drive letter, or install directory anywhere in
 * it, so a reader can verify the rule without being told whose machine it was.
 *
 * It deliberately reads the *tracked* set rather than the working tree:
 * untracked local files are exactly what the boundary is supposed to keep out.
 *
 * Several search patterns below are assembled from fragments. That is not
 * obfuscation: it keeps this file from matching the very strings it looks for, so
 * the scan needs no exception list and can stay honest about its own source.
 *
 * Usage: node tools/verify-repo-boundary.mjs [--verbose]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A backslash, spelled without one: the patterns below need it literally. */
const SEP = String.fromCharCode(92);

/** Largest tracked file that is still plausible for a plugin like this. */
const MAX_TRACKED_BYTES = 2 * 1024 * 1024;
/** Extensions treated as binary: content rules do not apply to them. */
const BINARY_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ico', '.gif', '.zip', '.pdf', '.woff', '.woff2']);
/** Files above this size are not read as text even when the extension allows it. */
const MAX_TEXT_BYTES = 1024 * 1024;

/**
 * Shapes of an absolute local path. Assembled from fragments so this file is
 * not itself a match.
 *
 * The drive pattern requires a directory name of at least two characters after
 * the separator. A single letter is not enough: an escaped newline inside source
 * - `published:` followed by a newline - otherwise reads as a drive path, which is
 * exactly the kind of false positive that would make this check untrustworthy.
 */
const LOCAL_PATH_PATTERNS = [
  new RegExp('[A-Za-z]:[' + SEP + SEP + '/][A-Za-z0-9._-]{2,}', 'u'),
  new RegExp('/(?:ho' + 'me|Us' + 'ers)/[a-z0-9._-]+/', 'u'),
  new RegExp('/' + 'c/' + 'Us' + 'ers/', 'u'),
  new RegExp('/' + 'mn' + 't/c/' + 'Us' + 'ers/', 'u'),
];

/** Credential shapes. Prefixes are split so this file does not match itself. */
const SECRET_PATTERNS = [
  new RegExp('-{5}BEGIN [A-Z ]*PRIVATE KEY-{5}', 'u'),
  new RegExp(SEP + SEP + 'b' + 's' + 'k-[A-Za-z0-9]{16,}', 'u'),
  new RegExp(SEP + SEP + 'b' + 'gh' + 'p_[A-Za-z0-9]{20,}', 'u'),
  new RegExp(SEP + SEP + 'b' + 'AK' + 'IA[0-9A-Z]{12,}', 'u'),
  new RegExp(SEP + SEP + 'b' + 'xo' + 'xb-[A-Za-z0-9-]{10,}', 'u'),
  new RegExp(SEP + SEP + 'b' + 'pass' + 'word' + SEP + 's*[:=]' + SEP + 's*' + SEP + 'S', 'iu'),
  new RegExp(SEP + SEP + 'b' + 'sec' + 'ret' + SEP + 's*[:=]' + SEP + 's*' + SEP + 'S', 'iu'),
  new RegExp(SEP + SEP + 'b' + 'api' + 'Key' + SEP + 's*[:=]' + SEP + 's*' + SEP + 'S', 'u'),
  new RegExp(SEP + SEP + 'b' + 'tok' + 'en' + SEP + 's*[:=]' + SEP + 's*[A-Za-z0-9._-]{12,}', 'u'),
];

/** Paths that indicate runtime state or build output slipped into the commit. */
const FORBIDDEN_TRACKED = [
  { label: 'installed dependencies', test: (path) => /(^|\/)node_modules\//u.test(path) },
  { label: 'build output', test: (path) => /(^|\/)(dist|build|coverage)\//u.test(path) },
  { label: 'runtime configuration', test: (path) => /(^|\/)config\.json$/u.test(path) },
  { label: 'a lockfile this project does not use', test: (path) => /(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(path) },
  { label: 'a local backup', test: (path) => /\.(bak|orig|rej)(-|$)/u.test(path) || /\.bak$/u.test(path) },
  { label: 'a log file', test: (path) => /\.log$/u.test(path) },
  { label: 'internal planning notes', test: (path) => /(^|\/)DESIGN\.md$/u.test(path) || /^docs\//u.test(path) },
];

/**
 * @param cwd directory inside the repository
 * @returns the repository root reported by git
 */
function repoRoot(cwd) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
}

/**
 * @param root repository root
 * @returns tracked paths relative to the root, with forward slashes
 */
function trackedFiles(root) {
  const output = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return output
    .split('\0')
    .filter((entry) => entry !== '')
    .map((entry) => entry.replace(new RegExp(SEP + SEP, 'gu'), '/'));
}

/**
 * Scan one file.
 * @param root repository root
 * @param relative path relative to the root
 * @returns a list of findings
 */
function scanFile(root, relative) {
  const findings = [];
  const absolute = join(root, relative);

  for (const rule of FORBIDDEN_TRACKED) {
    if (rule.test(relative)) findings.push({ file: relative, line: 0, kind: 'tracked', message: rule.label });
  }

  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    findings.push({ file: relative, line: 0, kind: 'missing', message: 'listed by git but not present in the working tree' });
    return findings;
  }

  if (stats.size > MAX_TRACKED_BYTES) {
    findings.push({
      file: relative,
      line: 0,
      kind: 'size',
      message: (stats.size / 1024 / 1024).toFixed(1) + ' MiB is larger than the ' + MAX_TRACKED_BYTES / 1024 / 1024 + ' MiB limit',
    });
  }

  if (BINARY_EXTENSIONS.has(extname(relative).toLowerCase())) return findings;
  if (stats.size > MAX_TEXT_BYTES) return findings;

  let text;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch {
    return findings;
  }

  const lines = text.split(/\r?\n/u);
  for (const [index, line] of lines.entries()) {
    for (const pattern of LOCAL_PATH_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ file: relative, line: index + 1, kind: 'path', message: 'absolute local path matching ' + pattern });
      }
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ file: relative, line: index + 1, kind: 'secret', message: 'credential-shaped text matching ' + pattern });
      }
    }
  }

  return findings;
}

function main() {
  const verbose = process.argv.includes('--verbose');
  const cwd = dirname(fileURLToPath(import.meta.url));
  let root;
  try {
    root = repoRoot(cwd);
  } catch {
    console.error('verify-repo-boundary: not inside a git repository');
    return 2;
  }

  let files;
  try {
    files = trackedFiles(root);
  } catch (error) {
    console.error('verify-repo-boundary: cannot list tracked files (' + error.message + ')');
    return 2;
  }

  const findings = [];
  let bytes = 0;
  for (const relative of files) {
    try {
      bytes += statSync(join(root, relative)).size;
    } catch {
      /* reported by scanFile */
    }
    findings.push(...scanFile(root, relative));
  }

  if (verbose) {
    for (const relative of files) console.log('  tracked  ' + relative);
  }

  console.log('verify-repo-boundary: ' + files.length + ' tracked file(s), ' + (bytes / 1024).toFixed(0) + ' KiB');

  if (findings.length === 0) {
    console.log('OK - no local absolute path, credential, runtime state, or oversized file in the published set.');
    return 0;
  }

  console.error('\nFAIL - ' + findings.length + ' problem(s) would be published:\n');
  for (const finding of findings) {
    const location = finding.line > 0 ? finding.file + ':' + finding.line : finding.file;
    console.error('  [' + finding.kind + '] ' + location + ' - ' + finding.message);
  }
  console.error('\nFix the file, or add it to .gitignore if it should stay local.');
  return 1;
}

process.exitCode = main();
