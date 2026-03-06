#!/usr/bin/env node

// NOTE: The subagent model patch is NOT compatible with native binary installations.
//
// The native binary (Bun-compiled) has precomputed string metadata that prevents
// changing the length of string values. Model names ("haiku", "sonnet", "opus",
// "inherit") are all different lengths, so no cross-model replacements are possible
// without corrupting the binary.
//
// This patch only works with npm-based installations (cli.js), which are deprecated.
//
// To request native subagent model configuration support from Anthropic:
// https://github.com/anthropics/claude-code/issues

console.log('Claude Code Subagent Model Configuration Patcher');
console.log('=================================================\n');
console.log('This patch is NOT compatible with native binary installations.\n');
console.log('The native binary (Bun-compiled) has precomputed string metadata');
console.log('that prevents changing model name lengths. Since all model names');
console.log('("haiku", "sonnet", "opus", "inherit") have different lengths,');
console.log('no cross-model replacements are possible.\n');
console.log('To request native subagent model configuration from Anthropic:');
console.log('  https://github.com/anthropics/claude-code/issues');
process.exit(1);
