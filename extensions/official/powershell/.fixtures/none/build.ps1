param([string]$Configuration = 'Release')
dotnet build -c $Configuration
