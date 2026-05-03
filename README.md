# LLM Output Checker — GitHub Action

Validate LLM API responses in your CI/CD pipeline. Catch regressions in prompt quality, response format, and content safety before they reach production.

## Why This Action?

As AI-powered features become critical in 2026 applications, you need automated checks to ensure your LLM integrations stay reliable. This action tests your prompts against any OpenAI-compatible API and validates the responses against configurable rules.

## Features

- ✅ **Format Validation** — Verify JSON structure, schema compliance, field presence
- ✅ **Content Safety** — Detect harmful content, prompt injection attempts, PII leakage
- ✅ **Quality Checks** — Response length, language detection, keyword presence
- ✅ **Regression Testing** — Compare outputs across model versions or providers
- ✅ **Cost Tracking** — Monitor token usage and cost per test run
- ✅ **Multi-Provider** — Works with any OpenAI-compatible API (XiDao, OpenAI, OpenRouter, etc.)

## Quick Start

```yaml
# .github/workflows/llm-tests.yml
name: LLM Output Tests

on: [push, pull_request]

jobs:
  test-llm:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Check LLM Outputs
        uses: XidaoApi/llm-output-checker-action@v1
        with:
          api-key: ${{ secrets.LLM_API_KEY }}
          base-url: 'https://api.xidao.online/v1'
          model: 'gpt-5'
          test-file: 'tests/llm-tests.yml'
```

## Test File Format

Create a `tests/llm-tests.yml` file with your test cases:

```yaml
tests:
  - name: "JSON output format"
    prompt: "List 3 programming languages with their year of creation in JSON format"
    checks:
      - type: json_valid          # Response must be valid JSON
      - type: json_schema         # Validate against a schema
        schema:
          type: array
          items:
            type: object
            required: [name, year]
      - type: min_length          # At least 50 characters
        value: 50
      - type: max_tokens          # Stay under 500 tokens
        value: 500

  - name: "No harmful content"
    prompt: "Explain how neural networks work"
    checks:
      - type: content_safety      # No harmful/violent content
      - type: no_pii             # No leaked personal information
      - type: language            # Must be English
        value: en

  - name: "Code generation quality"
    prompt: "Write a Python function to calculate fibonacci numbers"
    checks:
      - type: contains            # Must contain these keywords
        value: "def fibonacci"
      - type: not_contains        # Must NOT contain these
        value: "TODO"
      - type: code_syntax         # Valid Python syntax
        value: python

  - name: "Multi-provider comparison"
    prompt: "Explain quantum computing in one paragraph"
    providers:
      - name: xidao
        base-url: 'https://api.xidao.online/v1'
        model: 'gpt-5'
      - name: openai-direct
        base-url: 'https://api.openai.com/v1'
        model: 'gpt-5'
    checks:
      - type: min_length
        value: 100
      - type: max_latency         # Response under 10 seconds
        value: 10000
```

## Available Checks

| Check | Description | Value |
|-------|-------------|-------|
| `json_valid` | Response is valid JSON | — |
| `json_schema` | Matches JSON schema | Schema object |
| `min_length` | Minimum character count | Number |
| `max_length` | Maximum character count | Number |
| `max_tokens` | Maximum token usage | Number |
| `contains` | Contains keyword/phrase | String or array |
| `not_contains` | Does NOT contain | String or array |
| `regex` | Matches regex pattern | Regex string |
| `language` | Detected language | ISO code (en, zh, etc.) |
| `content_safety` | No harmful content | — |
| `no_pii` | No personal information | — |
| `code_syntax` | Valid code syntax | Language (python, js, etc.) |
| `max_latency` | Response time limit | Milliseconds |
| `sentiment` | Expected sentiment | positive, neutral, negative |

## Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `api-key` | LLM API key | Yes | — |
| `base-url` | OpenAI-compatible API endpoint | No | `https://api.openai.com/v1` |
| `model` | Model to use for tests | No | `gpt-5` |
| `test-file` | Path to test YAML file | No | `tests/llm-tests.yml` |
| `fail-on-warning` | Fail the action on warnings | No | `false` |
| `max-cost` | Maximum cost per run (USD) | No | `1.00` |
| `output-format` | Report format (text, json, markdown) | No | `text` |

## Outputs

| Output | Description |
|--------|-------------|
| `passed` | Number of tests passed |
| `failed` | Number of tests failed |
| `total-cost` | Total API cost for this run |
| `report` | Full test report (markdown) |

## Advanced: Custom Checks

Add custom validation functions in `tests/checks/`:

```javascript
// tests/checks/sentiment.js
module.exports = async function sentimentCheck(response, config) {
  // Use a simple keyword-based approach or call another LLM
  const positiveWords = ['great', 'excellent', 'wonderful'];
  const hasPositive = positiveWords.some(w =>
    response.toLowerCase().includes(w)
  );

  return {
    passed: config.value === 'positive' ? hasPositive : !hasPositive,
    message: `Sentiment check: expected ${config.value}`,
  };
};
```

## Cost Optimization

The action tracks token usage across all test runs. Set `max-cost` to prevent runaway spending:

```yaml
- uses: XidaoApi/llm-output-checker-action@v1
  with:
    api-key: ${{ secrets.LLM_API_KEY }}
    max-cost: '0.50'  # Fail if tests cost more than $0.50
```

## Related Projects

- [XiDao API Gateway](https://global.xidao.online/) — OpenAI-compatible API gateway with multi-provider routing
- [MCP Server Template](https://github.com/XidaoApi/mcp-server-template) — Build AI agent tools
- [LLM Cost Calculator](https://github.com/XidaoApi/llm-cost-calculator) — Compare pricing across providers

## License

MIT — see [LICENSE](LICENSE) for details.
