# Read-only presence enumeration for the CP210x USB adapter. Never opens a COM port.
# PnP instance paths are used only for local filtering and are never serialized.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

try {
    $source = 'Pnp'
    try {
        $present = @(Get-PnpDevice -PresentOnly -ErrorAction Stop)
    } catch {
        $source = 'Cim'
        $present = @(Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction Stop | Where-Object { $_.Present -eq $true })
    }
    $devices = @($present | Where-Object {
        $id = if ($source -eq 'Pnp') { $_.InstanceId } else { $_.PNPDeviceID }
        $id -match '^USB\\VID_10C4&PID_EA60(?:&[^\\]+)?\\'
    } | ForEach-Object {
        $device = $_
        $label = if ($source -eq 'Pnp') { $device.FriendlyName } else { $device.Name }
        $port = $null
        if ($label -match '\((COM[1-9][0-9]{0,4})\)\s*$') { $port = $Matches[1].ToUpperInvariant() }
        $problemCode = $device.ConfigManagerErrorCode
        if ($null -eq $problemCode -and $source -eq 'Pnp') {
            try {
                $problemCode = (Get-PnpDeviceProperty -InstanceId $device.InstanceId -KeyName 'DEVPKEY_Device_ProblemCode' -ErrorAction Stop).Data
            } catch { $problemCode = $null }
        }
        $status = if ($device.Status -match '^(OK|Error|Unknown|Degraded|Disabled)$') { [string]$device.Status } else { 'Unknown' }
        @{
            Name = 'Silicon Labs CP210x USB to UART Bridge'
            Port = $port
            Status = $status
            ProblemCode = $(if ($null -ne $problemCode) { [int]$problemCode } else { $null })
        }
    } | Sort-Object -Property Port)
    @{ Available = $true; Devices = @($devices); Error = $null } | ConvertTo-Json -Depth 4 -Compress
} catch {
    @{ Available = $false; Devices = @(); Error = 'USB_STATE_UNAVAILABLE' } | ConvertTo-Json -Depth 4 -Compress
}
