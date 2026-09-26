param(
    [string]$NameContains = 'E06-003B'
)

# Read-only CoreAudio snapshot. No setters, playback, capture, or UI automation.
# Session enumeration reports the sessions visible at the time of this snapshot.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

if (-not ('GlassesAudioReadOnly.Probe' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace GlassesAudioReadOnly {
    public class Report {
        public string CapturedAtUtc;
        public string NameContains;
        public List<DefaultInfo> DefaultRender = new List<DefaultInfo>();
        public List<EndpointInfo> MatchingEndpoints = new List<EndpointInfo>();
        public List<string> Errors = new List<string>();
    }
    public class DefaultInfo {
        public string Role;
        public string Name;
        public string Id;
        public string Error;
    }
    public class EndpointInfo {
        public string Flow;
        public string Name;
        public string Id;
        public uint StateMask;
        public string State;
        public double? MasterVolumePercent;
        public bool? Muted;
        public string VolumeError;
        public List<SessionInfo> Sessions = new List<SessionInfo>();
        public string SessionError;
    }
    public class SessionInfo {
        public string DisplayName;
        public uint? ProcessId;
        public string ProcessName;
        public string State;
        public double? VolumePercent;
        public bool? Muted;
        public string Error;
    }

    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumeratorObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint stateMask, out IMMDeviceCollection devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
    }
    [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceCollection {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int Item(uint index, out IMMDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(uint mode, out IPropertyStore properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }
    [StructLayout(LayoutKind.Sequential)]
    struct PropertyKey {
        public Guid FormatId;
        public uint PropertyId;
        public PropertyKey(Guid formatId, uint propertyId) { FormatId = formatId; PropertyId = propertyId; }
    }
    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PropVariant {
        [FieldOffset(0)] public ushort Type;
        [FieldOffset(8)] public IntPtr Pointer;
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPropertyStore {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }
    // Unused setter declarations preserve the native COM vtable layout.
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioEndpointVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr callback);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr callback);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float level, IntPtr eventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr eventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, IntPtr eventContext);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr eventContext);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, IntPtr eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
    }
    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2 {
        [PreserveSig] int GetAudioSessionControl(IntPtr sessionGuid, uint streamFlags, out IntPtr control);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr sessionGuid, uint streamFlags, out IntPtr volume);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
    }
    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator {
        [PreserveSig] int GetCount(out int count);
        [PreserveSig] int GetSession(int index, out IAudioSessionControl session);
    }
    [ComImport, Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr context);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(ref Guid grouping, IntPtr context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr callback);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr callback);
    }
    [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2 {
        [PreserveSig] int GetState(out int state);
        [PreserveSig] int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
        [PreserveSig] int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, IntPtr context);
        [PreserveSig] int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
        [PreserveSig] int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr context);
        [PreserveSig] int GetGroupingParam(out Guid grouping);
        [PreserveSig] int SetGroupingParam(ref Guid grouping, IntPtr context);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr callback);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr callback);
        [PreserveSig] int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetProcessId(out uint id);
        [PreserveSig] int IsSystemSoundsSession();
        [PreserveSig] int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);
    }
    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume {
        [PreserveSig] int SetMasterVolume(float level, IntPtr eventContext);
        [PreserveSig] int GetMasterVolume(out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }

    public static class Probe {
        [DllImport("ole32.dll")]
        static extern int PropVariantClear(ref PropVariant value);

        static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }
        static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
        static string Error(Exception ex) { return ex.Message + " (0x" + ex.HResult.ToString("X8") + ")"; }

        static string Name(IMMDevice device) {
            IPropertyStore properties = null;
            PropVariant value = new PropVariant();
            try {
                Check(device.OpenPropertyStore(0, out properties)); // STGM_READ
                PropertyKey key = new PropertyKey(new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"), 14);
                Check(properties.GetValue(ref key, out value));
                if (value.Type == 31) return Marshal.PtrToStringUni(value.Pointer);
                if (value.Type == 8) return Marshal.PtrToStringBSTR(value.Pointer);
                return "<friendly name variant " + value.Type + ">";
            } finally { PropVariantClear(ref value); Release(properties); }
        }
        static string StateName(uint state) {
            List<string> labels = new List<string>();
            if ((state & 1) != 0) labels.Add("Active");
            if ((state & 2) != 0) labels.Add("Disabled");
            if ((state & 4) != 0) labels.Add("NotPresent");
            if ((state & 8) != 0) labels.Add("Unplugged");
            return labels.Count == 0 ? "Unknown" : String.Join("|", labels.ToArray());
        }
        static void ReadVolume(IMMDevice device, EndpointInfo info) {
            object activated = null;
            try {
                Guid iid = typeof(IAudioEndpointVolume).GUID;
                Check(device.Activate(ref iid, 23, IntPtr.Zero, out activated));
                IAudioEndpointVolume volume = (IAudioEndpointVolume)activated;
                float level;
                bool muted;
                Check(volume.GetMasterVolumeLevelScalar(out level));
                info.MasterVolumePercent = Math.Round(level * 100.0, 2);
                Check(volume.GetMute(out muted));
                info.Muted = muted;
            } catch (Exception ex) { info.VolumeError = Error(ex); }
            finally { Release(activated); }
        }
        static void ReadSessions(IMMDevice device, EndpointInfo info) {
            object activated = null;
            IAudioSessionEnumerator enumerator = null;
            try {
                Guid iid = typeof(IAudioSessionManager2).GUID;
                Check(device.Activate(ref iid, 23, IntPtr.Zero, out activated));
                IAudioSessionManager2 manager = (IAudioSessionManager2)activated;
                Check(manager.GetSessionEnumerator(out enumerator));
                int count;
                Check(enumerator.GetCount(out count));
                for (int index = 0; index < count; index++) {
                    IAudioSessionControl control = null;
                    SessionInfo session = new SessionInfo();
                    info.Sessions.Add(session);
                    try {
                        Check(enumerator.GetSession(index, out control));
                        int state;
                        Check(control.GetState(out state));
                        session.State = state == 0 ? "Inactive" : state == 1 ? "Active" : state == 2 ? "Expired" : "Unknown";
                        string displayName;
                        Check(control.GetDisplayName(out displayName));
                        session.DisplayName = displayName;
                        IAudioSessionControl2 control2 = control as IAudioSessionControl2;
                        if (control2 != null) {
                            uint processId;
                            Check(control2.GetProcessId(out processId));
                            session.ProcessId = processId;
                            if (processId == 0) session.ProcessName = "System sounds or multi-process session";
                            else try { using (Process process = Process.GetProcessById((int)processId)) session.ProcessName = process.ProcessName; } catch { session.ProcessName = "<unavailable>"; }
                        }
                        ISimpleAudioVolume volume = control as ISimpleAudioVolume;
                        if (volume != null) {
                            float level;
                            bool muted;
                            Check(volume.GetMasterVolume(out level));
                            session.VolumePercent = Math.Round(level * 100.0, 2);
                            Check(volume.GetMute(out muted));
                            session.Muted = muted;
                        }
                    } catch (Exception ex) { session.Error = Error(ex); }
                    finally { Release(control); }
                }
            } catch (Exception ex) { info.SessionError = Error(ex); }
            finally { Release(enumerator); Release(activated); }
        }
        static Report ReadOnMta(string filter) {
            Report report = new Report();
            report.CapturedAtUtc = DateTime.UtcNow.ToString("o");
            report.NameContains = filter;
            IMMDeviceEnumerator enumerator = null;
            try {
                enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorObject();
                string[] roles = new string[] { "Console", "Multimedia", "Communications" };
                for (int role = 0; role < roles.Length; role++) {
                    DefaultInfo info = new DefaultInfo();
                    info.Role = roles[role];
                    report.DefaultRender.Add(info);
                    IMMDevice device = null;
                    try {
                        Check(enumerator.GetDefaultAudioEndpoint(0, role, out device));
                        info.Name = Name(device);
                        string id;
                        Check(device.GetId(out id));
                        info.Id = id;
                    } catch (Exception ex) { info.Error = Error(ex); }
                    finally { Release(device); }
                }
                for (int flow = 0; flow < 2; flow++) {
                    IMMDeviceCollection devices = null;
                    try {
                        Check(enumerator.EnumAudioEndpoints(flow, 15, out devices));
                        uint count;
                        Check(devices.GetCount(out count));
                        for (uint index = 0; index < count; index++) {
                            IMMDevice device = null;
                            try {
                                Check(devices.Item(index, out device));
                                string name = Name(device);
                                if (name == null || name.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                                EndpointInfo info = new EndpointInfo();
                                info.Flow = flow == 0 ? "Render" : "Capture";
                                info.Name = name;
                                string id;
                                uint state;
                                Check(device.GetId(out id));
                                Check(device.GetState(out state));
                                info.Id = id;
                                info.StateMask = state;
                                info.State = StateName(state);
                                report.MatchingEndpoints.Add(info);
                                // Only active endpoints are activated; no disconnected device is opened.
                                if ((state & 1) != 0) {
                                    ReadVolume(device, info);
                                    ReadSessions(device, info);
                                }
                            } catch (Exception ex) { report.Errors.Add("Endpoint " + flow + "/" + index + ": " + Error(ex)); }
                            finally { Release(device); }
                        }
                    } catch (Exception ex) { report.Errors.Add("Flow " + flow + ": " + Error(ex)); }
                    finally { Release(devices); }
                }
            } catch (Exception ex) { report.Errors.Add(Error(ex)); }
            finally { Release(enumerator); }
            return report;
        }
        public static Report Read(string filter) {
            if (String.IsNullOrWhiteSpace(filter)) throw new ArgumentException("A non-empty device name filter is required.");
            Report report = null;
            Exception error = null;
            Thread worker = new Thread(delegate() {
                try { report = ReadOnMta(filter); } catch (Exception ex) { error = ex; }
            });
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.MTA);
            worker.Start();
            if (!worker.Join(15000)) throw new TimeoutException("Read-only CoreAudio snapshot exceeded 15 seconds.");
            if (error != null) throw error;
            return report;
        }
    }
}
'@
}

[GlassesAudioReadOnly.Probe]::Read($NameContains) | ConvertTo-Json -Depth 8
