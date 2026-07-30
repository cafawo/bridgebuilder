param(
  [string]$Token = "",
  [string]$ApiBase = "https://bridgebuilder.goatcounter.com/api/v0",
  [string]$OutputPath = "static/data/leaderboard.json",
  [string]$GeneratorPath = "static/game/js/generator.js",
  [string]$PhysicsPath = "static/game/js/physics.js",
  [string]$FixturePath = ""
)

$ErrorActionPreference = "Stop"
$LeaderboardSchemaVersion = 2
$CostEventPrefix = "bridgebuilder-cost"
$CapacityEventPrefix = "bridgebuilder-capacity"
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

function Convert-ToDecimal {
  param([object]$Value)

  $parsed = 0D
  if (
    [Decimal]::TryParse(
      [string]$Value,
      [Globalization.NumberStyles]::Number,
      [Globalization.CultureInfo]::InvariantCulture,
      [ref]$parsed
    )
  ) {
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

function Add-CapacityEntry {
  param(
    [hashtable]$Entries,
    [hashtable]$CapacityEntries,
    [string]$Seed,
    [Int64]$Cost,
    [Int64]$RequiredLoad,
    [Int64]$MaxLoad
  )

  if (
    $Seed -notmatch $SeedPattern -or
    $Cost -le 0 -or
    $RequiredLoad -le 0 -or
    $MaxLoad -lt $RequiredLoad
  ) {
    return
  }

  Add-BestEntry `
    -Entries $Entries `
    -Seed $Seed `
    -Cost $Cost `
    -RequiredLoad $RequiredLoad

  $ratio = [Decimal]$MaxLoad / [Decimal]$Cost
  $previous = $CapacityEntries[$Seed]
  if ($null -eq $previous) {
    $CapacityEntries[$Seed] = [PSCustomObject][ordered]@{
      highestLoad = $MaxLoad
      loadPerCost = $ratio
    }
    return
  }
  if ($MaxLoad -gt [Int64]$previous.highestLoad) {
    $previous.highestLoad = $MaxLoad
  }
  if ($ratio -gt [Decimal]$previous.loadPerCost) {
    $previous.loadPerCost = $ratio
  }
}

$generatorVersion = Get-ExportedVersion -Path $GeneratorPath -Name "GENERATOR_VERSION"
$physicsVersion = Get-ExportedVersion -Path $PhysicsPath -Name "PHYSICS_VERSION"
$bestBySeed = @{}
$capacityBySeed = @{}
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
        $highestLoad = Convert-ToInteger $entry.highestLoad
        $loadPerCost = Convert-ToDecimal $entry.loadPerCost
        if (
          $bestBySeed.ContainsKey([string]$entry.seed) -and
          $null -ne $requiredLoad -and
          $null -ne $highestLoad -and
          $null -ne $loadPerCost -and
          $highestLoad -ge $requiredLoad -and
          $loadPerCost -gt 0
        ) {
          $capacityBySeed[[string]$entry.seed] = [PSCustomObject][ordered]@{
            highestLoad = $highestLoad
            loadPerCost = $loadPerCost
          }
        }
      }
    }
  } catch {
    $bestBySeed = @{}
    $capacityBySeed = @{}
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
      $parts.Count -lt 4 -or
      $parts[1] -ne $EventVersion -or
      $parts[2] -ne $generatorVersion -or
      $parts[3] -ne $physicsVersion
    ) {
      continue
    }

    if ($parts[0] -eq $CostEventPrefix -and $parts.Count -eq 7) {
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
      continue
    }

    if ($parts[0] -eq $CapacityEventPrefix -and $parts.Count -eq 8) {
      $requiredLoad = Convert-ToInteger $parts[4]
      $cost = Convert-ToInteger $parts[6]
      $maxLoad = Convert-ToInteger $parts[7]
      if (
        $null -eq $requiredLoad -or
        $null -eq $cost -or
        $null -eq $maxLoad
      ) {
        continue
      }
      Add-CapacityEntry `
        -Entries $bestBySeed `
        -CapacityEntries $capacityBySeed `
        -Seed $parts[5] `
        -Cost $cost `
        -RequiredLoad $requiredLoad `
        -MaxLoad $maxLoad
    }
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
  $resetCursorAfterNotFound = $false
  $more = $true
  while ($more) {
    $cursorBeforeRequest = $lastPathId
    $uri = "$($ApiBase.TrimEnd('/'))/paths?limit=200&after=$lastPathId"
    try {
      $page = Invoke-RestMethod -Uri $uri -Headers $headers -Method Get
    } catch {
      $statusCode = $null
      if ($null -ne $_.Exception.Response -and $null -ne $_.Exception.Response.StatusCode) {
        $statusCode = [Int32]$_.Exception.Response.StatusCode
      }
      if (
        $statusCode -eq 404 -and
        -not $resetCursorAfterNotFound -and
        $lastPathId -gt 0
      ) {
        $lastPathId = 0L
        $resetCursorAfterNotFound = $true
        continue
      }
      throw
    }
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
    Select-Object -First 100 |
    ForEach-Object {
      $capacity = $capacityBySeed[[string]$_.seed]
      $highestLoad = $null
      $loadPerCost = $null
      if ($null -ne $capacity) {
        $highestLoad = [Int64]$capacity.highestLoad
        $loadPerCost = [Math]::Round([Decimal]$capacity.loadPerCost, 6)
      }
      [PSCustomObject][ordered]@{
        seed = [string]$_.seed
        cost = [Int64]$_.cost
        requiredLoad = [Int64]$_.requiredLoad
        highestLoad = $highestLoad
        loadPerCost = $loadPerCost
      }
    }
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
