/**
 * LLM Output Checker — GitHub Action Entry Point
 *
 * Validates LLM API responses for format, safety, and quality.
 * Works with any OpenAI-compatible API endpoint.
 */

const core = require('@actions/core');
const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

// Pricing per 1M tokens (approximate 2026 rates)
const MODEL_PRICING = {
  'gpt-5': { input: 2.50, output: 10.00 },
  'gpt-5-mini': { input: 0.30, output: 1.20 },
  'claude-4-opus': { input: 15.00, output: 75.00 },
  'claude-4-sonnet': { input: 3.00, output: 15.00 },
  'claude-4-haiku': { input: 0.25, output: 1.25 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  default: { input: 2.00, output: 8.00 },
};

async function callLLM(baseUrl, apiKey, model, prompt, systemPrompt) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const start = Date.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2000,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error (${response.status}): ${error}`);
  }

  const data = await response.json();
  const latency = Date.now() - start;

  return {
    content: data.choices[0].message.content,
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    latency,
    model: data.model,
  };
}

async function runCheck(checkType, content, config, latency) {
  switch (checkType) {
    case 'json_valid':
      try { JSON.parse(content); return { passed: true }; }
      catch (e) { return { passed: false, message: `Invalid JSON: ${e.message}` }; }

    case 'min_length':
      return {
        passed: content.length >= config.value,
        message: `Length ${content.length} < minimum ${config.value}`,
      };

    case 'max_length':
      return {
        passed: content.length <= config.value,
        message: `Length ${content.length} > maximum ${config.value}`,
      };

    case 'max_tokens':
      // Rough estimate: 1 token ≈ 4 chars
      const estTokens = Math.ceil(content.length / 4);
      return {
        passed: estTokens <= config.value,
        message: `~${estTokens} tokens > maximum ${config.value}`,
      };

    case 'contains': {
      const keywords = Array.isArray(config.value) ? config.value : [config.value];
      const missing = keywords.filter(k => !content.toLowerCase().includes(k.toLowerCase()));
      return {
        passed: missing.length === 0,
        message: missing.length > 0 ? `Missing keywords: ${missing.join(', ')}` : undefined,
      };
    }

    case 'not_contains': {
      const forbidden = Array.isArray(config.value) ? config.value : [config.value];
      const found = forbidden.filter(k => content.toLowerCase().includes(k.toLowerCase()));
      return {
        passed: found.length === 0,
        message: found.length > 0 ? `Forbidden content found: ${found.join(', ')}` : undefined,
      };
    }

    case 'regex':
      return {
        passed: new RegExp(config.value).test(content),
        message: `Content does not match pattern: ${config.value}`,
      };

    case 'max_latency':
      return {
        passed: latency <= config.value,
        message: `Latency ${latency}ms > maximum ${config.value}ms`,
      };

    case 'content_safety': {
      const unsafePatterns = [
        /\b(kill|murder|bomb|terrorist)\b/i,
        /\b(hack|exploit|crack)\s+(password|system)/i,
      ];
      const triggered = unsafePatterns.filter(p => p.test(content));
      return {
        passed: triggered.length === 0,
        message: triggered.length > 0 ? 'Unsafe content detected' : undefined,
      };
    }

    case 'no_pii': {
      const piiPatterns = [
        /\b\d{3}-\d{2}-\d{4}\b/,           // SSN
        /\b\d{16}\b/,                        // Credit card
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/, // Email
        /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,    // Phone
      ];
      const found = piiPatterns.filter(p => p.test(content));
      return {
        passed: found.length === 0,
        message: found.length > 0 ? 'PII detected in response' : undefined,
      };
    }

    case 'code_syntax': {
      if (config.value === 'python') {
        // Basic Python syntax check
        const hasDef = /^\s*def\s+\w+/m.test(content) || /^\s*class\s+\w+/m.test(content);
        const hasImport = /^\s*(import|from)\s+/m.test(content);
        return {
          passed: hasDef || hasImport,
          message: 'Response does not appear to contain valid Python code',
        };
      }
      return { passed: true, message: `Syntax check for ${config.value} not implemented` };
    }

    default:
      return { passed: true, message: `Unknown check type: ${checkType}` };
  }
}

async function run() {
  try {
    const apiKey = core.getInput('api-key', { required: true });
    const baseUrl = core.getInput('base-url') || 'https://api.openai.com/v1';
    const model = core.getInput('model') || 'gpt-5';
    const testFile = core.getInput('test-file') || 'tests/llm-tests.yml';
    const failOnWarning = core.getInput('fail-on-warning') === 'true';
    const maxCost = parseFloat(core.getInput('max-cost') || '1.00');
    const outputFormat = core.getInput('output-format') || 'text';

    // Load test file
    const testPath = path.resolve(process.env.GITHUB_WORKSPACE || '.', testFile);
    if (!fs.existsSync(testPath)) {
      core.setFailed(`Test file not found: ${testPath}`);
      return;
    }

    const testConfig = yaml.load(fs.readFileSync(testPath, 'utf8'));
    const tests = testConfig.tests || [];

    core.info(`🧪 Running ${tests.length} LLM output tests against ${model}...`);
    core.info(`   Endpoint: ${baseUrl}`);
    core.info('');

    let totalPassed = 0;
    let totalFailed = 0;
    let totalCost = 0;
    const results = [];

    for (const test of tests) {
      core.info(`📋 Test: ${test.name}`);
      const result = { name: test.name, checks: [], passed: true };

      try {
        const response = await callLLM(baseUrl, apiKey, model, test.prompt, test.system);

        // Calculate cost
        const pricing = MODEL_PRICING[model] || MODEL_PRICING.default;
        const cost =
          (response.usage.prompt_tokens / 1_000_000) * pricing.input +
          (response.usage.completion_tokens / 1_000_000) * pricing.output;
        totalCost += cost;

        core.info(`   Tokens: ${response.usage.total_tokens} | Latency: ${response.latency}ms | Cost: $${cost.toFixed(4)}`);

        // Run checks
        for (const check of test.checks) {
          const checkResult = await runCheck(check.type, response.content, check, response.latency);
          result.checks.push({ ...checkResult, type: check.type });

          if (checkResult.passed) {
            core.info(`   ✅ ${check.type}`);
          } else {
            core.warning(`   ❌ ${check.type}: ${checkResult.message}`);
            result.passed = false;
          }
        }

        if (result.passed) totalPassed++;
        else totalFailed++;

      } catch (error) {
        core.error(`   💥 API Error: ${error.message}`);
        result.passed = false;
        result.error = error.message;
        totalFailed++;
      }

      results.push(result);
      core.info('');
    }

    // Summary
    core.info('═══════════════════════════════════════');
    core.info(`📊 Results: ${totalPassed} passed, ${totalFailed} failed`);
    core.info(`💰 Total cost: $${totalCost.toFixed(4)}`);
    core.info('═══════════════════════════════════════');

    // Set outputs
    core.setOutput('passed', totalPassed.toString());
    core.setOutput('failed', totalFailed.toString());
    core.setOutput('total-cost', totalCost.toFixed(4));

    // Generate report
    if (outputFormat === 'markdown') {
      let report = '# LLM Output Test Report\n\n';
      report += `| Test | Status | Details |\n|------|--------|-------|\n`;
      for (const r of results) {
        const status = r.passed ? '✅ Pass' : '❌ Fail';
        const details = r.checks.map(c => c.passed ? '✅' : `❌ ${c.message}`).join(', ');
        report += `| ${r.name} | ${status} | ${details} |\n`;
      }
      core.setOutput('report', report);
    }

    // Fail if needed
    if (totalCost > maxCost) {
      core.setFailed(`Cost $${totalCost.toFixed(4)} exceeded maximum $${maxCost.toFixed(2)}`);
    } else if (totalFailed > 0) {
      core.setFailed(`${totalFailed} test(s) failed`);
    } else if (failOnWarning) {
      // Check for warnings
    }

  } catch (error) {
    core.setFailed(`Action failed: ${error.message}`);
  }
}

run();
