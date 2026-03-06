#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const isRestore = args.includes('--restore');
const showHelp = args.includes('--help') || args.includes('-h');

const VERSION = '2.1.69';

if (showHelp) {
  console.log(`Claude Code Thinking Visibility Patcher v${VERSION}`);
  console.log('==============================================\n');
  console.log('Patches the native Claude Code binary to show thinking blocks by default.\n');
  console.log('Usage: node patch-thinking.js [options]\n');
  console.log('Options:');
  console.log('  --dry-run    Preview changes without applying them');
  console.log('  --restore    Restore from backup file');
  console.log('  --help, -h   Show this help message\n');
  console.log('Examples:');
  console.log('  node patch-thinking.js              # Apply patch');
  console.log('  node patch-thinking.js --dry-run    # Preview changes');
  console.log('  node patch-thinking.js --restore    # Restore original');
  process.exit(0);
}

console.log(`Claude Code Thinking Visibility Patcher v${VERSION}`);
console.log('==============================================\n');

// Auto-detect Claude Code native binary path
function getClaudeCodePath() {
  const homeDir = os.homedir();
  const attemptedPaths = [];

  function checkPath(testPath, method) {
    if (!testPath) return null;
    attemptedPaths.push({ path: testPath, method });
    try {
      if (fs.existsSync(testPath)) {
        const realPath = fs.realpathSync(testPath);
        return realPath;
      }
    } catch (error) {
      // Path check failed, continue
    }
    return null;
  }

  // PRIORITY 1: Native binary installation (default since ~v2.1.19)
  const nativeVersionsDir = path.join(homeDir, '.local', 'share', 'claude', 'versions');
  if (fs.existsSync(nativeVersionsDir)) {
    try {
      const versions = fs.readdirSync(nativeVersionsDir)
        .filter(f => !f.includes('.backup') && !f.startsWith('.'))
        .sort((a, b) => {
          // Sort by semver descending
          const aParts = a.split('.').map(Number);
          const bParts = b.split('.').map(Number);
          for (let i = 0; i < 3; i++) {
            if ((bParts[i] || 0) !== (aParts[i] || 0)) return (bParts[i] || 0) - (aParts[i] || 0);
          }
          return 0;
        });
      if (versions.length > 0) {
        const latestVersion = versions[0];
        const binaryPath = path.join(nativeVersionsDir, latestVersion);
        const found = checkPath(binaryPath, 'native binary');
        if (found) return found;
      }
    } catch (error) {
      // Continue to fallback methods
    }
  }

  // PRIORITY 2: Resolve from 'which claude' symlink
  if (process.platform !== 'win32') {
    try {
      const claudeBinary = execSync('which claude', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
      if (claudeBinary) {
        const found = checkPath(claudeBinary, 'which claude');
        if (found) return found;
      }
    } catch (e) {
      // Continue
    }
  }

  getClaudeCodePath.attemptedPaths = attemptedPaths;
  return null;
}

const targetPath = getClaudeCodePath();

if (!targetPath) {
  console.error('Error: Could not find Claude Code installation\n');
  console.error('Searched using the following methods:\n');
  const attemptedPaths = getClaudeCodePath.attemptedPaths || [];
  if (attemptedPaths.length > 0) {
    attemptedPaths.forEach(({ path: p, method }) => {
      console.error(`  [${method}] ${p}`);
    });
  }
  console.error('\nTroubleshooting:');
  console.error('  1. Verify Claude Code is installed: claude --version');
  console.error('  2. Check ~/.local/share/claude/versions/ for the binary');
  console.error('  3. Check that "which claude" resolves to the binary');
  process.exit(1);
}

console.log(`Found Claude Code at: ${targetPath}\n`);

// Check if it's a native binary
const fileType = execSync(`file "${targetPath}"`, { encoding: 'utf8' }).trim();
const isNativeBinary = fileType.includes('Mach-O') || fileType.includes('ELF');

if (!isNativeBinary) {
  console.error('Error: Expected a native binary but found:', fileType);
  console.error('This patcher only supports native binary installations.');
  process.exit(1);
}

console.log('Detected native binary installation\n');

const backupPath = targetPath + '.backup';

// Restore from backup
if (isRestore) {
  if (!fs.existsSync(backupPath)) {
    console.error('Error: Backup file not found at:', backupPath);
    console.error('\nThe backup is created when you first apply the patch.');
    process.exit(1);
  }

  console.log('Restoring from backup...');
  fs.copyFileSync(backupPath, targetPath);
  // Re-sign after restore
  try {
    execSync(`codesign -fs - "${targetPath}"`, { stdio: 'ignore' });
    console.log('Restored and re-signed successfully!');
  } catch (e) {
    console.log('Restored successfully! (codesign skipped)');
  }
  console.log('\nPlease restart Claude Code for changes to take effect.');
  process.exit(0);
}

// Read binary
console.log('Reading binary...');
const data = fs.readFileSync(targetPath);
const dataStr = data.toString('utf8');

// Check if already patched
if (dataStr.includes('isTranscriptMode:!0,verbose:!0,hideInTranscript:!1')) {
  console.log('Thinking visibility patch:');
  console.log('  Already applied\n');
  if (isDryRun) {
    console.log('DRY RUN - No changes needed\n');
  }
  process.exit(0);
}

// Find the thinking case block by locating the distinctive createElement with thinking props
// Then walk backwards to find the start of the case block
const marker = 'isTranscriptMode:';
const createElementWithThinking = dataStr.indexOf(',isTranscriptMode:');
if (createElementWithThinking === -1) {
  console.error('Thinking visibility patch:');
  console.error('  Pattern not found - could not locate thinking createElement');
  process.exit(1);
}

// Find all case"thinking":{ blocks and check which one contains the thinking createElement
let searchStart = 0;
let originalPattern = null;

while (true) {
  const caseIdx = dataStr.indexOf('case"thinking":{if(!', searchStart);
  if (caseIdx === -1) break;

  // Extract until we find the closing pattern: return VAR}
  // Walk forward to find the end - look for "return " followed by a short var and "}"
  let depth = 0;
  let endIdx = caseIdx + 16; // past case"thinking":
  for (let i = caseIdx + 16; i < caseIdx + 500; i++) {
    if (dataStr[i] === '{') depth++;
    if (dataStr[i] === '}') {
      if (depth === 0) {
        endIdx = i + 1;
        break;
      }
      depth--;
    }
  }

  const block = dataStr.substring(caseIdx, endIdx);

  // Verify this is the right block (has createElement with thinking props)
  if (block.includes('isTranscriptMode:') && block.includes('hideInTranscript:') && block.includes('createElement')) {
    originalPattern = block;
    break;
  }

  searchStart = caseIdx + 1;
}

if (!originalPattern) {
  console.error('Thinking visibility patch:');
  console.error('  Pattern not found - may need update for newer version');
  console.error('\nRun "claude --version" to check the installed version.');
  process.exit(1);
}

console.log('Thinking visibility patch:');
console.log('  Pattern found - ready to apply');
console.log(`  Pattern length: ${originalPattern.length} bytes\n`);

// Extract variable names from the pattern
// Pattern: case"thinking":{if(!VAR1&&!VAR2)return null;let VAR3=VAR1&&...
const nullCheckMatch = originalPattern.match(/if\(!(\w+)&&!(\w+)\)return null/);
if (!nullCheckMatch) {
  console.error('Error: Could not parse null check variables');
  process.exit(1);
}
const var1 = nullCheckMatch[1]; // isTranscriptMode (e.g., P)
const var2 = nullCheckMatch[2]; // verbose (e.g., H)

// Extract hideInTranscript variable: let VAR3=...
const hideVarMatch = originalPattern.match(/;let (\w+)=/);
if (!hideVarMatch) {
  console.error('Error: Could not parse hideInTranscript variable');
  process.exit(1);
}
const var3 = hideVarMatch[1]; // hideInTranscript (e.g., G)

console.log(`  Variables: isTranscriptMode=${var1}, verbose=${var2}, hideInTranscript=${var3}`);

// Build replacement - same byte length required for binary patching
// Do all substitutions first (without padding), then pad the null check removal area
let replacement = originalPattern;

// 1. Remove null return check entirely (will pad this area later)
const nullCheck = `if(!${var1}&&!${var2})return null;`;
replacement = replacement.replace(nullCheck, '\x00PADDING_PLACEHOLDER\x00');

// 2. Simplify hideInTranscript calc: "let G=P&&!(!j||Y===j),M" -> "let G=!1,M"
const hideCalcRegex = new RegExp(`let ${var3}=.+?,(?=\\w+;if)`);
const hideCalcMatch = replacement.match(hideCalcRegex);
if (hideCalcMatch) {
  const orig = hideCalcMatch[0];
  replacement = replacement.replace(orig, `let ${var3}=!1,`);
}

// 3. Replace prop values in createElement (no padding - just direct substitution)
replacement = replacement.replace(`isTranscriptMode:${var1}`, 'isTranscriptMode:!0');
replacement = replacement.replace(`verbose:${var2}`, 'verbose:!0');
replacement = replacement.replace(`hideInTranscript:${var3}`, 'hideInTranscript:!1');

// 4. Replace cache comparisons and assignments
function replaceVar(str, varName, literal) {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  str = str.replace(new RegExp(`!==${escaped}(?=[|)])`, 'g'), `!==${literal}`);
  str = str.replace(new RegExp(`\\]=${escaped}(?=,)`, 'g'), `]=${literal}`);
  return str;
}
replacement = replaceVar(replacement, var1, '!0');
replacement = replaceVar(replacement, var2, '!0');
replacement = replaceVar(replacement, var3, '!1');

// 5. Calculate how much padding we need and fill the placeholder
const placeholderLen = '\x00PADDING_PLACEHOLDER\x00'.length;
const currentLen = replacement.length;
const targetLen = originalPattern.length;
// The placeholder takes placeholderLen bytes; we need (targetLen - currentLen + placeholderLen) spaces
const paddingNeeded = targetLen - currentLen + placeholderLen;

if (paddingNeeded < 0) {
  console.error(`Error: Replacement is ${-paddingNeeded} bytes too long even without padding.`);
  console.error('This is a bug in the patcher. Please report it.');
  process.exit(1);
}

replacement = replacement.replace('\x00PADDING_PLACEHOLDER\x00', ' '.repeat(paddingNeeded));

// Final verification
if (replacement.length !== originalPattern.length) {
  console.error(`Error: Replacement length mismatch (${replacement.length} vs ${originalPattern.length})`);
  console.error('This is a bug in the patcher. Please report it.');
  process.exit(1);
}

if (isDryRun) {
  console.log('DRY RUN - No changes will be made\n');
  console.log('Would apply thinking visibility patch');
  console.log(`  Pattern: ${originalPattern.substring(0, 60)}...`);
  console.log(`  Replace: ${replacement.substring(0, 60)}...`);
  console.log('\nRun without --dry-run to apply.');
  process.exit(0);
}

// Create backup
if (!fs.existsSync(backupPath)) {
  console.log('Creating backup...');
  fs.copyFileSync(targetPath, backupPath);
  console.log(`Backup created: ${backupPath}\n`);
}

// Apply patch using Buffer for binary safety
console.log('Applying patch...');
const searchBuf = Buffer.from(originalPattern, 'utf8');
const replaceBuf = Buffer.from(replacement, 'utf8');

let patchCount = 0;
let offset = 0;
const patched = Buffer.from(data);

while (true) {
  const idx = patched.indexOf(searchBuf, offset);
  if (idx === -1) break;
  replaceBuf.copy(patched, idx);
  patchCount++;
  offset = idx + searchBuf.length;
}

console.log(`Applied to ${patchCount} location(s)\n`);

// Write patched binary
console.log('Writing patched binary...');
fs.writeFileSync(targetPath, patched);

// Re-sign the binary (macOS)
if (process.platform === 'darwin') {
  console.log('Re-signing binary (ad-hoc)...');
  try {
    execSync(`codesign -fs - "${targetPath}"`, { stdio: 'ignore' });
    console.log('Binary re-signed successfully\n');
  } catch (e) {
    console.error('Warning: codesign failed. The binary may not run on macOS.');
    console.error('You can try manually: codesign -fs - "' + targetPath + '"');
  }
}

console.log('Patch applied! Please restart Claude Code for changes to take effect.');
console.log('\nTo restore original behavior, run: node patch-thinking.js --restore');
process.exit(0);
