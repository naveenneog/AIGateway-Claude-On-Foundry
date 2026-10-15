[CmdletBinding()]
param([Parameter(Mandatory)][string]$SettingsPath)
$ErrorActionPreference = 'Stop'
$settings = (Resolve-Path -LiteralPath $SettingsPath).Path
$model = (Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json).env.ANTHROPIC_MODEL
if (-not $model) { throw 'Profile must select an explicit gateway model ID.' }
$work = Join-Path (Split-Path $PSScriptRoot) '.local\cli-smoke'
$null = New-Item -ItemType Directory -Path $work -Force
$variables = @('ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX')
$previous = @{}
Push-Location $work
try {
    foreach ($name in $variables) {
        $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
    $result = & claude --bare --strict-mcp-config --tools '' --settings $settings --model $model --system-prompt 'You are a connectivity test. Reply with only OK. Do not use tools.' --no-session-persistence --max-budget-usd 0.05 --output-format json --print 'Reply with only OK.' | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $result.is_error -or $result.result.Trim() -ne 'OK' -or $result.duration_api_ms -le 0) {
        throw "Claude client verification failed: $($result.result)"
    }
} finally {
    foreach ($name in $variables) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
    Pop-Location
}
[pscustomobject]@{
    client = 'Claude Code'
    result = $result.result
    inputTokens = $result.usage.input_tokens
    outputTokens = $result.usage.output_tokens
    apiDurationMs = $result.duration_api_ms
} | ConvertTo-Json
