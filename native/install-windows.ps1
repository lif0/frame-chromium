param([Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'This installer is for Windows.' }
if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 "$PSScriptRoot\install.py" $ExtensionId
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python "$PSScriptRoot\install.py" $ExtensionId
} else {
    throw 'Python 3 was not found. Install Python, reopen PowerShell and try again.'
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
