# psake 构建脚本
Properties {
    $Configuration = 'Release'
}

# Task Commented -depends Clean
Task default -depends Test

Task Clean {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue ./out
}

Task Build -depends Clean {
    dotnet build -c $Configuration
}

Task -Name Test -depends Build -description '运行测试' {
    Invoke-Pester -CI
}

TaskSetup {
    Write-Host "开始 $($psake.context.Peek().currentTaskName)"
}

Task "Pack" -depends Build {
    dotnet pack -c $Configuration -o ./out
}
