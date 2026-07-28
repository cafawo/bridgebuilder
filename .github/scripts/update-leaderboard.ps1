param(
  [string]$Token = "",
  [string]$ApiBase = "https://bridgebuilder.goatcounter.com/api/v0",
  [string]$OutputPath = "static/data/leaderboard.json",
  [string]$GeneratorPath = "static/game/js/generator.js",
  [string]$PhysicsPath = "static/game/js/physics.js",
  [string]$FixturePath = ""
)

$ErrorActionPreference = "Stop"
$LeaderboardSchemaVersion = 1
$EventPrefix = "bridgebuilder-cost"
$EventVersion = "v1"
$SeedPattern = "^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$"

function Get-ExportedVersion {
  param(
    [string]$Path,
    [string]$Name
  )

  $source = Get-Content -LiteralPath $Path -Raw
  $pattern = 'export\s+const\s+' + [Regex]::Escape($Name) + '\s*=\s*"([^"]+)"'
  $match = [Regex]::Match($source, $pattern)
  if (-not $match.Success) {
    throw "Could not read $Name from $Path"
  }
  return $match.Groups[1].Value
}

function Convert-ToInteger {
  param([object]$Value)

  $parsed = 0L
  if ([Int64]::TryParse([string]$Value, [ref]$parsed)) {
    return $parsed
  }
  return $null
}

function Add-BestEntry {
  param(
    [hashtable]$Entries,
    [string]$Seed,
    [Int64]$Cost,
    [Int64]$RequiredLoad
  )

  if (
    $Seed -notmatch $SeedPattern -or
    $Cost -lt 0 -or
    $RequiredLoad -le 0
  ) {
    return
  }
  $previous = $Entries[$Seed]
  if ($null -eq $previous -or $Cost -lt [Int64]$previous.cost) {
    $Entries[$Seed] = [PSCustomObject][ordered]@{
      seed = $Seed
      cost = $Cost
      requiredLoad = $RequiredLoad
    }
  }
}

$generatorVersion = Get-ExportedVersion -Path $GeneratorPath -Name "GENERATOR_VERSION"
$physicsVersion = Get-ExportedVersion -Path $PhysicsPath -Name "PHYSICS_VERSION"
$bestBySeed = @{}
$lastPathId = 0L

if (Test-Path -LiteralPath $OutputPath) {
  try {
    $current = Get-Content -LiteralPath $OutputPath -Raw | ConvertFrom-Json
    $compatible =
      $current.schemaVersion -eq $LeaderboardSchemaVersion -and
      $current.generatorVersion -eq $generatorVersion -and
      $current.physicsVersion -eq $physicsVersion
    if ($compatible) {
      $parsedCursor = Convert-ToInteger $current.lastPathId
      if ($null -ne $parsedCursor -and $parsedCursor -ge 0) {
        $lastPathId = $parsedCursor
      }
      foreach ($entry in @($current.entries)) {
        $cost = Convert-ToInteger $entry.cost
        $requiredLoad = Convert-ToInteger $entry.requiredLoad
        if ($null -ne $cost -and $null -ne $requiredLoad) {
          Add-BestEntry `
            -Entries $bestBySeed `
            -Seed ([string]$entry.seed) `
            -Cost $cost `
            -RequiredLoad $requiredLoad
        }
      }
    }
  } catch {
    $bestBySeed = @{}
    $lastPathId = 0L
  }
}

function Add-GoatCounterPaths {
  param([object[]]$Paths)

  foreach ($pathEntry in $Paths) {
    $pathId = Convert-ToInteger $pathEntry.id
    if ($null -eq $pathId -or $pathId -lt 0) {
      throw "GoatCounter returned an invalid path id"
    }
    if ($pathId -gt $script:lastPathId) {
      $script:lastPathId = $pathId
    }
    if ($pathEntry.event -ne $true) {
      continue
    }

    $parts = ([string]$pathEntry.path).Split("/")
    if (
      $parts.Count -ne 7 -or
      $parts[0] -ne $EventPrefix -or
      $parts[1] -ne $EventVersion -or
      $parts[2] -ne $generatorVersion -or
      $parts[3] -ne $physicsVersion
    ) {
      continue
    }
    $requiredLoad = Convert-ToInteger $parts[4]
    $cost = Convert-ToInteger $parts[6]
    if ($null -eq $requiredLoad -or $null -eq $cost) {
      continue
    }
    Add-BestEntry `
      -Entries $bestBySeed `
      -Seed $parts[5] `
      -Cost $cost `
      -RequiredLoad $requiredLoad
  }
}

if ($FixturePath) {
  $fixture = Get-Content -LiteralPath $FixturePath -Raw | ConvertFrom-Json
  if ($null -eq $fixture.pages) {
    throw "Fixture does not contain pages"
  }
  foreach ($page in @($fixture.pages)) {
    if ($null -eq $page.paths) {
      throw "Fixture page does not contain paths"
    }
    Add-GoatCounterPaths -Paths @($page.paths)
  }
} else {
  if (-not $Token) {
    throw "GOATCOUNTER_API_TOKEN is required"
  }
  $headers = @{
    Authorization = "Bearer $Token"
    Accept = "application/json"
    "Content-Type" = "application/json"
  }
  $more = $true
  while ($more) {
    $cursorBeforeRequest = $lastPathId
    $uri = "$($ApiBase.TrimEnd('/'))/paths?limit=200&after=$lastPathId"
    $page = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    if ($null -eq $page.paths) {
      throw "GoatCounter response does not contain paths"
    }
    $paths = @($page.paths)
    Add-GoatCounterPaths -Paths $paths
    $more = $page.more -eq $true
    if ($more -and ($paths.Count -eq 0 -or $lastPathId -le $cursorBeforeRequest)) {
      throw "GoatCounter pagination did not advance"
    }
  }
}

$entries = @(
  $bestBySeed.Values |
    Sort-Object `
      @{ Expression = { [Int64]$_.cost }; Ascending = $true },
      @{ Expression = { [string]$_.seed }; Ascending = $true } |
    Select-Object -First 100
)
$snapshot = [ordered]@{
  schemaVersion = $LeaderboardSchemaVersion
  generatedAt = [DateTime]::UtcNow.ToString("o")
  generatorVersion = $generatorVersion
  physicsVersion = $physicsVersion
  lastPathId = $lastPathId
  entries = $entries
}

$outputFullPath = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = [IO.Path]::GetDirectoryName($outputFullPath)
[IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$temporaryPath = Join-Path $outputDirectory ([IO.Path]::GetRandomFileName())
try {
  $json = $snapshot | ConvertTo-Json -Depth 5
  [IO.File]::WriteAllText(
    $temporaryPath,
    $json + [Environment]::NewLine,
    [Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $temporaryPath -Destination $outputFullPath -Force
} finally {
  if (Test-Path -LiteralPath $temporaryPath) {
    Remove-Item -LiteralPath $temporaryPath -Force
  }
}
