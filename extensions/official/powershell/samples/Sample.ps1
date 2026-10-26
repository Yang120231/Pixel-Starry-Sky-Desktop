#Requires -Version 5.1
<#
.SYNOPSIS
    示例脚本：统计文件夹里各扩展名的文件数。
.PARAMETER Path
    要统计的文件夹。
#>
[CmdletBinding(SupportsShouldProcess)]
param (
    [Parameter(Mandatory, ValueFromPipeline)]
    [ValidateScript({ Test-Path -LiteralPath $_ -PathType Container })]
    [string]$Path,

    [ValidateSet('Name', 'Count')]
    [string]$SortBy = 'Count',

    [switch]$Recurse
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

enum Level { Debug; Info; Warn }

class Counter {
    [string]$Name
    [int]$Total = 0
    hidden [datetime]$Started = (Get-Date)

    Counter([string]$name) {
        $this.Name = $name
    }

    [void] Add([int]$n) {
        $this.Total += $n
    }

    [string] ToString() {
        return "$($this.Name): $($this.Total)"
    }
}

function Write-Log {
    param (
        [Level]$Level = [Level]::Info,
        [string]$Message
    )
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Write-Host "[$stamp] [$Level] $Message" -ForegroundColor DarkGray
}

function Get-ExtensionCount {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param (
        [string]$Folder,
        [switch]$Recurse
    )

    $options = @{ LiteralPath = $Folder; File = $true; Recurse = $Recurse.IsPresent }
    $files = Get-ChildItem @options
    $groups = $files | Group-Object { $_.Extension.ToLower() }

    foreach ($g in $groups) {
        [pscustomobject]@{
            Extension = if ($g.Name) { $g.Name } else { '(无扩展名)' }
            Count     = $g.Count
            SizeMB    = [math]::Round(($g.Group | Measure-Object Length -Sum).Sum / 1MB, 2)
        }
    }
}

try {
    Write-Log -Message "开始统计 $Path"
    $rows = Get-ExtensionCount -Folder $Path -Recurse:$Recurse |
        Sort-Object -Property $SortBy -Descending

    $total = [Counter]::new('全部')
    $rows | ForEach-Object { $total.Add($_.Count) }

    switch ($rows.Count) {
        0 { Write-Warning '文件夹是空的' }
        { $_ -gt 100 } { Write-Log -Level Warn -Message '扩展名种类很多' }
        default { Write-Log -Message "共 $($rows.Count) 种扩展名" }
    }

    $note = @"
文件夹: $Path
合计: $($total.Total) 个文件
"@
    $raw = @'
这里的 $Path 不会被展开
'@
    $rows | Format-Table -AutoSize
    Write-Output $note, $raw, 0x1F, 3.14, 1e3
}
catch [System.IO.IOException] {
    Write-Error "读取失败: $($_.Exception.Message)"
}
finally {
    $global:LASTEXITCODE = 0
}
