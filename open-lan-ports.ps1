# Allows other devices on your local network to reach the KCX dev servers.
# Run once, as Administrator:  powershell -ExecutionPolicy Bypass -File open-lan-ports.ps1
# Remove later with:  Get-NetFirewallRule -DisplayName "KCX dev*" | Remove-NetFirewallRule

$rules = @(
  @{ Name = "KCX dev web (3000)"; Port = 3000 },
  @{ Name = "KCX dev ws (4000)";  Port = 4000 }
)

foreach ($r in $rules) {
  if (Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue) {
    Write-Host "already exists: $($r.Name)"
    continue
  }
  # Private profile only — this does NOT expose the ports on public/untrusted networks.
  New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Protocol TCP `
    -LocalPort $r.Port -Action Allow -Profile Private | Out-Null
  Write-Host "opened TCP $($r.Port) on private networks"
}

Write-Host ""
Write-Host "KCX is now reachable at http://192.168.2.69:3000 from your network."
