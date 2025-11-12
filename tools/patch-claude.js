#!/usr/bin/env node

/**
 * Install and patch a version-specific Claude Code sandbox.
 *
 * Usage examples:
 *   ./patch-claude                    # install latest version + patch
 *   ./patch-claude --version 2.0.25   # install specific version
 *   ./patch-claude --skip-patch       # install only (no patch)
 *
 * Sandboxes live under sandboxes/<version>/ and are recreated on every run so each
 * install happens in a clean tree.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function info(msg) {
  console.log(`ℹ️  ${msg}`);
}

function step(icon, msg) {
  console.log(`${icon} ${msg}`);
}

function run(cmd, options = {}) {
  execSync(cmd, { stdio: 'inherit', ...options });
}

function printHelp() {
  console.log(`Usage: ./patch-claude [--version X.Y.Z] [--skip-patch]

Options:
  --version <semver>   Install a specific version of @anthropic-ai/claude-code
  --skip-patch         Install only (do not apply the kill-ring patch)
  --help               Show this help message`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const result = { version: null, skipPatch: false };
  while (args.length > 0) {
    const token = args.shift();
    switch (token) {
      case '--version':
        result.version = args.shift();
        if (!result.version) throw new Error('Missing value for --version');
        break;
      case '--skip-patch':
        result.skipPatch = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (token.startsWith('-')) {
          throw new Error(`Unknown argument: ${token}`);
        }
        if (result.version) {
          throw new Error(`Unexpected extra argument: ${token}`);
        }
        result.version = token;
    }
  }
  if (result.version && result.version.toLowerCase() === 'latest') {
    result.version = null;
  }
  return result;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resetSandbox(dir) {
  if (fs.existsSync(dir)) {
    step('🧹', `Removing existing sandbox ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function detectLatestVersion() {
  info('Detecting latest @anthropic-ai/claude-code version via npm view...');
  try {
    const version = execSync('npm view @anthropic-ai/claude-code version', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
    if (!version) throw new Error('Empty npm view response');
    info(`Latest version reported as ${version}`);
    return version;
  } catch (err) {
    throw new Error(`Failed to detect latest version automatically (pass --version). Underlying error: ${err.message}`);
  }
}

function readInstalledVersion(sandboxDir) {
  const pkgPath = path.join(sandboxDir, 'node_modules/@anthropic-ai/claude-code/package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

function recordPatchArtifacts(repoRoot, sandboxDir, installedVersion) {
  const statePath = path.join(sandboxDir, 'killring_patch_state.json');
  const patchesDir = path.join(repoRoot, 'patches', installedVersion);
  ensureDir(patchesDir);
  let patchState = null;
  let replacementsWritten = false;
  if (fs.existsSync(statePath)) {
    patchState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (patchState?.replacements) {
      const replacementsPath = path.join(patchesDir, 'replacements.json');
      const replacementsJson = JSON.stringify(patchState.replacements, null, 2);
      replacementsWritten = writeFileIfChanged(replacementsPath, replacementsJson);
    }
    try {
      fs.unlinkSync(statePath);
    } catch (err) {
      info(`Could not remove temporary patch state (${err.message})`);
    }
  }
  const replacementsFile = path.join(patchesDir, 'replacements.json');
  const hasReplacements = fs.existsSync(replacementsFile);
  const replacementsPath = hasReplacements ? path.relative(repoRoot, replacementsFile) : null;

  const metadataPath = path.join(patchesDir, 'metadata.json');
  const existingMetadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    : null;

  const metadata = {
    version: installedVersion,
    recordedAt: replacementsWritten || !existingMetadata ? new Date().toISOString() : existingMetadata.recordedAt,
    sandbox: path.relative(repoRoot, sandboxDir),
    replacementsSource: patchState?.replacementsSource ?? null,
    replacements: replacementsPath,
    patchState
  };
  const metadataChanged = writeFileIfChanged(metadataPath, JSON.stringify(metadata, null, 2));
  if (replacementsWritten || metadataChanged) {
    info(`Stored patch metadata in ${path.relative(repoRoot, patchesDir)}/`);
  } else {
    info(`Patch metadata already up to date in ${path.relative(repoRoot, patchesDir)}/`);
  }
}

function main() {
  const { version: requestedVersion, skipPatch } = parseArgs(process.argv);
  const version = requestedVersion || detectLatestVersion();

  const repoRoot = path.resolve(__dirname, '..');
  const sandboxRoot = path.join(repoRoot, 'sandboxes');
  const sandboxDir = path.join(sandboxRoot, version);

  ensureDir(sandboxRoot);

  step('📦', `Preparing sandbox ${sandboxDir}`);
  resetSandbox(sandboxDir);
  ensureDir(sandboxDir);
  step('🧾', 'Initializing package.json');
  execSync('npm init -y', {
    cwd: sandboxDir,
    stdio: ['ignore', 'ignore', 'inherit']
  });

  step('⬇️', `Installing @anthropic-ai/claude-code@${version}`);
  execSync(`npm install --silent @anthropic-ai/claude-code@${version}`, {
    cwd: sandboxDir,
    stdio: ['ignore', 'ignore', 'inherit']
  });
  info('Install complete');

  const installedVersion = readInstalledVersion(sandboxDir);
  if (installedVersion !== version) {
    info(`Resolved version ${installedVersion} differs from requested spec ${version}`);
  }

  if (!skipPatch) {
    step('🪄', 'Applying kill-ring patch');
    const patchScript = path.join(repoRoot, 'tools', 'apply_killring_patch.js');
    if (!fs.existsSync(patchScript)) {
      throw new Error(`Patch script missing: ${patchScript}`);
    }
    run(`node "${patchScript}" --sandbox "${sandboxDir}"`);
    recordPatchArtifacts(repoRoot, sandboxDir, installedVersion);
  } else {
    info('Skipping patch (--skip-patch supplied)');
  }

  step('✅', `Sandbox ready: ${sandboxDir}`);
  console.log(`Next: ./claude ${installedVersion}`);
  console.log(`Alt : cd ${sandboxDir} && npx claude-code`);
  console.log('');
  console.log('🧪 Remember to test multi-line cut/yank operations:');
  console.log('   • Move up a line, Ctrl+K to kill 2 lines, then Ctrl+Y to yank back');
  console.log('   • Test that multi-line content pastes exactly as cut');
  console.log('   • See GitHub issue #5 for details');
}

try {
  main();
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

function writeFileIfChanged(filePath, contents) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing === contents) {
      return false;
    }
  }
  fs.writeFileSync(filePath, contents);
  return true;
}
