# Read-only desktop display enumeration. No registry, monitor configuration, or device writes.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace EyeOsDisplayBridge {
    public sealed class DesktopDisplay {
        public bool Primary { get; set; }
        public int X { get; set; }
        public int Y { get; set; }
        public int Width { get; set; }
        public int Height { get; set; }
    }

    public static class DisplayProbe {
        [StructLayout(LayoutKind.Sequential)]
        private struct Rect { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        private struct MonitorInfo {
            public uint Size;
            public Rect Monitor;
            public Rect Work;
            public uint Flags;
        }

        private delegate bool MonitorCallback(IntPtr monitor, IntPtr hdc, ref Rect rect, IntPtr data);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorCallback callback, IntPtr data);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);

        [DllImport("user32.dll")]
        private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

        public static DesktopDisplay[] Read() {
            // DPI context is changed only for this probe thread and restored afterwards.
            // This does not change Windows display settings or another application's layout.
            IntPtr previous = IntPtr.Zero;
            try { previous = SetThreadDpiAwarenessContext(new IntPtr(-4)); }
            catch (EntryPointNotFoundException) { }
            try {
                var result = new List<DesktopDisplay>();
                int callbackError = 0;
                MonitorCallback callback = delegate(IntPtr monitor, IntPtr hdc, ref Rect rect, IntPtr data) {
                    var info = new MonitorInfo();
                    info.Size = (uint)Marshal.SizeOf(typeof(MonitorInfo));
                    if (!GetMonitorInfo(monitor, ref info)) {
                        callbackError = Marshal.GetLastWin32Error();
                        if (callbackError == 0) callbackError = 1;
                        return false;
                    }
                    result.Add(new DesktopDisplay {
                        Primary = (info.Flags & 1) != 0,
                        X = info.Monitor.Left, Y = info.Monitor.Top,
                        Width = info.Monitor.Right - info.Monitor.Left,
                        Height = info.Monitor.Bottom - info.Monitor.Top,
                    });
                    return true;
                };
                bool success = EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
                GC.KeepAlive(callback);
                if (!success || callbackError != 0) {
                    throw new Win32Exception(callbackError != 0 ? callbackError : Marshal.GetLastWin32Error());
                }
                return result.ToArray();
            } finally {
                if (previous != IntPtr.Zero) SetThreadDpiAwarenessContext(previous);
            }
        }
    }
}
'@

$displays = @([EyeOsDisplayBridge.DisplayProbe]::Read() | Sort-Object -Property @{ Expression = 'Primary'; Descending = $true }, X, Y)
@{
    CapturedAtUtc = [DateTime]::UtcNow.ToString('o')
    Displays = @($displays)
} | ConvertTo-Json -Depth 4 -Compress
